"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Braces,
  Check,
  Globe2,
  Grip,
  Link2,
  RefreshCw,
  RotateCcw,
  Route,
  Server,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { OpsFunction } from "@/lib/types";
import { useToast } from "@/components/providers";
import { Badge, Button, Dialog, LoadError, Skeleton } from "@/components/ui";

type McpBinding = {
  id: string;
  functionId: string;
  toolName: string;
  title: string;
  enabled: boolean;
};

type HttpBinding = {
  id: string;
  functionId: string;
  method: string;
  path: string;
  enabled: boolean;
};

type MapEndpoint = {
  id: string;
  name: string;
  slug: string;
  kind: "mcp" | "http";
  status: string;
  mcpToolBindings: McpBinding[];
  httpRouteBindings: HttpBinding[];
};

type NodePosition = { x: number; y: number };
type Layout = Record<string, NodePosition>;
type BindingMapResponse = { endpoints: MapEndpoint[]; layout: unknown };
type PendingConnection = { endpoint: MapEndpoint; fn: OpsFunction };
type ConnectionPreviewBase = {
  pointerId: number;
  start: NodePosition;
  current: NodePosition;
};
type ConnectionPreview = ConnectionPreviewBase &
  (
    | {
        source: "function";
        functionId: string;
        colorKind: "mcp" | "http" | undefined;
      }
    | {
        source: "endpoint";
        endpointId: string;
        colorKind: "mcp" | "http";
      }
  );

type BindingNode = {
  id: string;
  endpointId: string;
  endpointKind: "mcp" | "http";
  functionId: string;
  label: string;
  detail: string;
  enabled: boolean;
  raw: McpBinding | HttpBinding;
};

const NODE_SIZE = {
  endpoint: { width: 280, height: 110 },
  binding: { width: 300, height: 92 },
  function: { width: 260, height: 84 },
};

export function BindingMap({ functions }: { functions: OpsFunction[] }) {
  const [endpoints, setEndpoints] = useState<MapEndpoint[]>();
  const [positions, setPositions] = useState<Layout>({});
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [activeNode, setActiveNode] = useState<string>();
  const [connectionPreview, setConnectionPreview] =
    useState<ConnectionPreview>();
  const [pendingConnection, setPendingConnection] =
    useState<PendingConnection>();
  const graphRef = useRef<HTMLDivElement>(null);
  const positionsRef = useRef<Layout>({});
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const dragRef = useRef<
    | {
        id: string;
        pointerId: number;
        startX: number;
        startY: number;
        origin: NodePosition;
      }
    | undefined
  >(undefined);
  const toast = useToast();
  const user = useCurrentUser();
  const canManage = roleAllows(user?.role, ["owner", "admin", "developer"]);

  const bindings = useMemo(() => flattenBindings(endpoints ?? []), [endpoints]);
  const defaultPositions = useMemo(
    () => buildDefaultLayout(endpoints ?? [], functions),
    [endpoints, functions],
  );

  const load = useCallback(() => {
    setError(undefined);
    api<BindingMapResponse>("/api/binding-map")
      .then((response) => {
        const defaults = buildDefaultLayout(response.endpoints, functions);
        const stored = readLayout(response.layout);
        const validStored = Object.fromEntries(
          Object.entries(stored).filter(([id]) => id in defaults),
        );
        const next = { ...defaults, ...validStored };
        positionsRef.current = next;
        setPositions(next);
        setEndpoints(response.endpoints);
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, [functions]);

  useEffect(load, [load, revision]);

  const queueSave = useCallback(
    (layout: Layout) => {
      const nodes = Object.entries(layout).map(([id, position]) => ({
        id,
        x: Math.round(position.x),
        y: Math.round(position.y),
      }));
      pendingSaves.current += 1;
      setSaving(true);
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(async () => {
          await api("/api/binding-map/layout", {
            method: "PATCH",
            body: JSON.stringify({ nodes }),
          });
        })
        .catch((reason) => {
          toast({
            title: "Layout was not saved",
            description: errorMessage(reason),
            tone: "error",
          });
        })
        .finally(() => {
          pendingSaves.current -= 1;
          if (pendingSaves.current === 0) setSaving(false);
        });
    },
    [toast],
  );

  function updatePosition(id: string, position: NodePosition) {
    const next = { ...positionsRef.current, [id]: position };
    positionsRef.current = next;
    setPositions(next);
  }

  function startDrag(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!canManage) return;
    const origin = positionsRef.current[id];
    if (!origin) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
    };
    setActiveNode(id);
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    updatePosition(drag.id, {
      x: clamp(drag.origin.x + event.clientX - drag.startX, 24, 4800),
      y: clamp(drag.origin.y + event.clientY - drag.startY, 24, 4800),
    });
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    setActiveNode(undefined);
    queueSave(positionsRef.current);
  }

  if (error)
    return (
      <LoadError
        title="Unable to load the binding map"
        message={error}
        onRetry={() => setRevision((value) => value + 1)}
      />
    );
  if (!endpoints) return <Skeleton className="h-[620px] w-full" />;

  const graphWidth = Math.max(
    1500,
    ...Object.entries(positions).map(
      ([id, position]) => position.x + nodeSize(id).width + 120,
    ),
  );
  const graphHeight = Math.max(
    680,
    ...Object.entries(positions).map(
      ([id, position]) => position.y + nodeSize(id).height + 120,
    ),
  );

  function resetLayout() {
    positionsRef.current = defaultPositions;
    setPositions(defaultPositions);
    queueSave(defaultPositions);
  }

  const dragHandle = (id: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) =>
      startDrag(id, event),
    onPointerMove: moveDrag,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
  });

  function graphPoint(clientX: number, clientY: number) {
    const bounds = graphRef.current?.getBoundingClientRect();
    return bounds
      ? { x: clientX - bounds.left, y: clientY - bounds.top }
      : { x: clientX, y: clientY };
  }

  function endpointConnectionTarget(clientX: number, clientY: number) {
    const target = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-endpoint-id]");
    return target
      ? (endpoints ?? []).find(
          (endpoint) => endpoint.id === target.dataset.endpointId,
        )
      : undefined;
  }

  function functionConnectionTarget(clientX: number, clientY: number) {
    const target = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-function-id]");
    return target
      ? functions.find(
          (fn) => fn.id === target.dataset.functionId && fn.enabled,
        )
      : undefined;
  }

  function startFunctionConnection(
    fn: OpsFunction,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!canManage || !fn.enabled) return;
    const position = positionsRef.current[`function:${fn.id}`];
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = {
      x: position.x,
      y: position.y + NODE_SIZE.function.height / 2,
    };
    setConnectionPreview({
      source: "function",
      functionId: fn.id,
      pointerId: event.pointerId,
      start,
      current: start,
      colorKind: undefined,
    });
  }

  function startEndpointConnection(
    endpoint: MapEndpoint,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!canManage) return;
    const position = positionsRef.current[`endpoint:${endpoint.id}`];
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = {
      x: position.x + NODE_SIZE.endpoint.width,
      y: position.y + NODE_SIZE.endpoint.height / 2,
    };
    setConnectionPreview({
      source: "endpoint",
      endpointId: endpoint.id,
      pointerId: event.pointerId,
      start,
      current: start,
      colorKind: endpoint.kind,
    });
  }

  function moveConnection(event: ReactPointerEvent<HTMLButtonElement>) {
    setConnectionPreview((current) => {
      if (!current || current.pointerId !== event.pointerId) return current;
      const point = graphPoint(event.clientX, event.clientY);
      if (current.source === "endpoint") return { ...current, current: point };
      const endpoint = endpointConnectionTarget(event.clientX, event.clientY);
      return { ...current, current: point, colorKind: endpoint?.kind };
    });
  }

  function finishConnection(event: ReactPointerEvent<HTMLButtonElement>) {
    const preview = connectionPreview;
    if (!preview || preview.pointerId !== event.pointerId) return;
    setConnectionPreview(undefined);
    if (preview.source === "function") {
      const endpoint = endpointConnectionTarget(event.clientX, event.clientY);
      const fn = functions.find(
        (candidate) => candidate.id === preview.functionId,
      );
      if (endpoint && fn) setPendingConnection({ endpoint, fn });
      return;
    }
    const endpoint = (endpoints ?? []).find(
      (candidate) => candidate.id === preview.endpointId,
    );
    const fn = functionConnectionTarget(event.clientX, event.clientY);
    if (endpoint && fn) setPendingConnection({ endpoint, fn });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Binding topology</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect in either direction between a service and Function. Use the
            grip to move nodes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-3 text-[10px] text-muted-foreground lg:flex">
            <span className="flex items-center gap-1">
              <i className="size-2 rounded-full bg-cyan-500" /> MCP
            </span>
            <span className="flex items-center gap-1">
              <i className="size-2 rounded-full bg-amber-500" /> HTTP
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {saving ? (
              <RefreshCw className="animate-spin" size={12} />
            ) : (
              <Check size={12} />
            )}
            {saving ? "Saving layout" : "Layout saved"}
          </span>
          {canManage && (
            <Button variant="secondary" size="sm" onClick={resetLayout}>
              <RotateCcw size={13} /> Reset layout
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      <div className="max-h-[72vh] min-h-[620px] overflow-auto rounded-xl border bg-muted/10">
        <div
          ref={graphRef}
          className="relative overflow-hidden bg-[radial-gradient(circle_at_1px_1px,hsl(var(--border))_1px,transparent_0)] bg-[length:22px_22px]"
          style={{ width: graphWidth, height: graphHeight }}
        >
          <GraphLaneLabel x={70} label="MCP / HTTP services" />
          <GraphLaneLabel x={580} label="Tools / routes" />
          <GraphLaneLabel x={1120} label="Functions" />
          <GraphEdges
            width={graphWidth}
            height={graphHeight}
            bindings={bindings}
            positions={positions}
            preview={connectionPreview}
          />

          {endpoints.map((endpoint) => {
            const id = `endpoint:${endpoint.id}`;
            const position = positions[id];
            if (!position) return null;
            return (
              <MovableNode
                key={id}
                id={id}
                position={position}
                size={NODE_SIZE.endpoint}
                active={activeNode === id}
                canMove={canManage}
                dragHandle={dragHandle(id)}
              >
                <EndpointNode
                  endpoint={endpoint}
                  functions={functions}
                  canManage={canManage}
                  connectionActive={
                    connectionPreview?.source === "function" ||
                    (connectionPreview?.source === "endpoint" &&
                      connectionPreview.endpointId === endpoint.id)
                  }
                  onConnect={(fn) => setPendingConnection({ endpoint, fn })}
                  onConnectionStart={(event) =>
                    startEndpointConnection(endpoint, event)
                  }
                  onConnectionMove={moveConnection}
                  onConnectionEnd={finishConnection}
                />
              </MovableNode>
            );
          })}

          {bindings.map((binding) => {
            const id = `binding:${binding.id}`;
            const position = positions[id];
            const endpoint = endpoints.find(
              (candidate) => candidate.id === binding.endpointId,
            );
            if (!position || !endpoint) return null;
            return (
              <MovableNode
                key={id}
                id={id}
                position={position}
                size={NODE_SIZE.binding}
                active={activeNode === id}
                canMove={canManage}
                dragHandle={dragHandle(id)}
              >
                <BindingNodeCard
                  binding={binding}
                  endpoint={endpoint}
                  fn={functions.find((fn) => fn.id === binding.functionId)}
                  canManage={canManage}
                  onChanged={() => setRevision((value) => value + 1)}
                />
              </MovableNode>
            );
          })}

          {functions.map((fn) => {
            const id = `function:${fn.id}`;
            const position = positions[id];
            if (!position) return null;
            return (
              <MovableNode
                key={id}
                id={id}
                position={position}
                size={NODE_SIZE.function}
                active={activeNode === id}
                canMove={canManage}
                dragHandle={dragHandle(id)}
              >
                <FunctionNode
                  fn={fn}
                  canManage={canManage}
                  connecting={
                    connectionPreview?.source === "function" &&
                    connectionPreview.functionId === fn.id
                  }
                  connectionTarget={connectionPreview?.source === "endpoint"}
                  onConnectionStart={(event) =>
                    startFunctionConnection(fn, event)
                  }
                  onConnectionMove={moveConnection}
                  onConnectionEnd={finishConnection}
                />
              </MovableNode>
            );
          })}

          {!endpoints.length && !functions.length && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dashed bg-card px-8 py-6 text-center text-sm text-muted-foreground">
              Create a Function or runtime endpoint to start the map.
            </div>
          )}
          {pendingConnection && (
            <ConnectDialog
              endpoint={pendingConnection.endpoint}
              fn={pendingConnection.fn}
              onChanged={() => setRevision((value) => value + 1)}
              onClose={() => setPendingConnection(undefined)}
            />
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Positions are shared with the Project. Binding changes remain drafts
        until the Project is deployed.
      </p>
    </div>
  );
}

function MovableNode({
  id,
  position,
  size,
  active,
  canMove,
  dragHandle,
  children,
}: {
  id: string;
  position: NodePosition;
  size: { width: number; height: number };
  active: boolean;
  canMove: boolean;
  dragHandle: {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  };
  children: ReactNode;
}) {
  return (
    <article
      data-node-id={id}
      className={`absolute rounded-xl shadow-md transition-shadow ${active ? "z-30 shadow-xl ring-2 ring-primary/30" : "z-10"}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      {children}
      <button
        type="button"
        aria-label={`Move ${id.split(":")[0]} node`}
        disabled={!canMove}
        className="absolute right-2 top-2 z-20 grid size-7 touch-none place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
        {...dragHandle}
      >
        <Grip size={14} />
      </button>
    </article>
  );
}

function EndpointNode({
  endpoint,
  functions,
  canManage,
  connectionActive,
  onConnect,
  onConnectionStart,
  onConnectionMove,
  onConnectionEnd,
}: {
  endpoint: MapEndpoint;
  functions: OpsFunction[];
  canManage: boolean;
  connectionActive: boolean;
  onConnect: (fn: OpsFunction) => void;
  onConnectionStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectionMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectionEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const [draggingOver, setDraggingOver] = useState(false);
  const bindingCount =
    endpoint.kind === "mcp"
      ? endpoint.mcpToolBindings.length
      : endpoint.httpRouteBindings.length;
  return (
    <div
      onDragEnter={(event) => {
        if (!canManage) return;
        event.preventDefault();
        setDraggingOver(true);
      }}
      onDragOver={(event) => {
        if (!canManage) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDraggingOver(false);
        const functionId = event.dataTransfer.getData(
          "application/x-mcpops-function",
        );
        const fn = functions.find(
          (candidate) => candidate.id === functionId && candidate.enabled,
        );
        if (canManage && fn) onConnect(fn);
      }}
      data-endpoint-id={endpoint.id}
      className={`relative size-full rounded-xl border-2 p-4 transition ${endpoint.kind === "mcp" ? "border-cyan-500/40 bg-cyan-500/[.055]" : "border-amber-500/40 bg-amber-500/[.055]"} ${draggingOver || connectionActive ? "shadow-lg ring-2 ring-offset-2 ring-offset-background" : ""} ${draggingOver || connectionActive ? (endpoint.kind === "mcp" ? "ring-cyan-500/30" : "ring-amber-500/30") : ""}`}
    >
      <button
        type="button"
        aria-label={`Connect ${endpoint.name}`}
        title="Drag to a Function"
        disabled={!canManage}
        onPointerDown={onConnectionStart}
        onPointerMove={onConnectionMove}
        onPointerUp={onConnectionEnd}
        onPointerCancel={onConnectionEnd}
        className={`absolute -right-2.5 top-1/2 z-30 size-5 touch-none -translate-y-1/2 rounded-full border-2 border-card shadow-sm transition hover:scale-125 hover:ring-4 disabled:cursor-default disabled:opacity-40 ${endpoint.kind === "mcp" ? "bg-cyan-500 hover:ring-cyan-500/20" : "bg-amber-500 hover:ring-amber-500/20"}`}
      />
      <div className="flex items-start gap-3 pr-7">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-lg ${endpoint.kind === "mcp" ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}
        >
          {endpoint.kind === "mcp" ? (
            <Server size={16} />
          ) : (
            <Globe2 size={16} />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {endpoint.kind === "mcp" ? "MCP service" : "HTTP service"}
          </p>
          <Link
            href={`${endpoint.kind === "mcp" ? "/mcp-endpoints" : "/http-apis"}/${endpoint.id}?tab=bindings`}
            className={`mt-1 block truncate text-sm font-semibold ${endpoint.kind === "mcp" ? "hover:text-cyan-600 dark:hover:text-cyan-400" : "hover:text-amber-600 dark:hover:text-amber-400"}`}
          >
            {endpoint.name}
          </Link>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
        <code>/{endpoint.slug}</code>
        <span>{bindingCount} routes/tools</span>
      </div>
    </div>
  );
}

function BindingNodeCard({
  binding,
  endpoint,
  fn,
  canManage,
  onChanged,
}: {
  binding: BindingNode;
  endpoint: MapEndpoint;
  fn: OpsFunction | undefined;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  const toast = useToast();
  async function remove() {
    if (
      !window.confirm("Remove this binding from the development configuration?")
    )
      return;
    setRemoving(true);
    try {
      await api(
        `/api/runtime-endpoints/${endpoint.id}/${endpoint.kind === "mcp" ? "mcp-bindings" : "http-bindings"}/${binding.id}`,
        { method: "DELETE" },
      );
      toast({
        title: "Binding removed",
        description: "Deploy the Project to publish this change.",
        tone: "success",
      });
      onChanged();
    } catch (reason) {
      toast({
        title: "Binding was not removed",
        description: errorMessage(reason),
        tone: "error",
      });
    } finally {
      setRemoving(false);
    }
  }
  return (
    <div
      className={`relative size-full rounded-xl border p-3 pr-16 ${binding.endpointKind === "mcp" ? "border-cyan-500/35 bg-cyan-500/[.045]" : "border-amber-500/35 bg-amber-500/[.045]"}`}
    >
      <span
        className={`absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-card ${binding.endpointKind === "mcp" ? "bg-cyan-500" : "bg-amber-500"}`}
      />
      <span
        className={`absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-card ${binding.endpointKind === "mcp" ? "bg-cyan-500" : "bg-amber-500"}`}
      />
      <div className="flex items-center gap-2">
        <span
          className={`grid size-8 shrink-0 place-items-center rounded-lg ${binding.endpointKind === "mcp" ? "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"}`}
        >
          {binding.endpointKind === "mcp" ? (
            <TerminalSquare size={15} />
          ) : (
            <Route size={15} />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {binding.endpointKind === "mcp" ? "Tool" : "Route"}
          </p>
          <code className="block truncate text-xs font-semibold">
            {binding.label}
          </code>
        </div>
      </div>
      <p className="mt-2 truncate text-[10px] text-muted-foreground">
        {endpoint.name} · {fn?.slug ?? "Unknown Function"}
      </p>
      {canManage && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute bottom-2 right-2 size-7 text-muted-foreground hover:text-red-500"
          loading={removing}
          onClick={() => void remove()}
          aria-label="Remove binding"
        >
          <Trash2 size={12} />
        </Button>
      )}
    </div>
  );
}

function FunctionNode({
  fn,
  canManage,
  connecting,
  connectionTarget,
  onConnectionStart,
  onConnectionMove,
  onConnectionEnd,
}: {
  fn: OpsFunction;
  canManage: boolean;
  connecting: boolean;
  connectionTarget: boolean;
  onConnectionStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectionMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectionEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      draggable={canManage && fn.enabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-mcpops-function", fn.id);
      }}
      data-function-id={fn.id}
      className={`relative size-full rounded-xl border border-violet-500/35 bg-violet-500/[.045] p-3 pr-10 ${canManage && fn.enabled ? "cursor-grab hover:border-violet-500/70" : "opacity-70"} ${connecting || connectionTarget ? "ring-2 ring-violet-500/30" : ""}`}
    >
      <button
        type="button"
        aria-label={`Connect ${fn.slug}`}
        title="Drag to an MCP or HTTP service"
        disabled={!canManage || !fn.enabled}
        onPointerDown={onConnectionStart}
        onPointerMove={onConnectionMove}
        onPointerUp={onConnectionEnd}
        onPointerCancel={onConnectionEnd}
        className="absolute -left-2.5 top-1/2 z-30 size-5 touch-none -translate-y-1/2 rounded-full border-2 border-card bg-violet-500 shadow-sm transition hover:scale-125 hover:ring-4 hover:ring-violet-500/20 disabled:cursor-default disabled:opacity-40"
      />
      <div className="flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
          <Braces size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Function
          </p>
          <Link
            href={`/functions/${fn.id}`}
            className="block truncate font-mono text-xs font-semibold hover:text-primary"
          >
            {fn.slug}
          </Link>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Badge tone={fn.enabled ? "success" : "neutral"}>
          {fn.enabled ? `v${fn.version}` : "disabled"}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {fn.riskLevel}
        </span>
      </div>
    </div>
  );
}

function GraphEdges({
  width,
  height,
  bindings,
  positions,
  preview,
}: {
  width: number;
  height: number;
  bindings: BindingNode[];
  positions: Layout;
  preview: ConnectionPreview | undefined;
}) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
      width={width}
      height={height}
    >
      <defs>
        <marker
          id="topology-arrow-mcp"
          markerHeight="7"
          markerWidth="7"
          orient="auto"
          refX="6"
          refY="3.5"
        >
          <path d="M 0 0 L 7 3.5 L 0 7 z" className="fill-cyan-500" />
        </marker>
        <marker
          id="topology-arrow-http"
          markerHeight="7"
          markerWidth="7"
          orient="auto"
          refX="6"
          refY="3.5"
        >
          <path d="M 0 0 L 7 3.5 L 0 7 z" className="fill-amber-500" />
        </marker>
        <marker
          id="topology-arrow-preview"
          markerHeight="7"
          markerWidth="7"
          orient="auto"
          refX="6"
          refY="3.5"
        >
          <path d="M 0 0 L 7 3.5 L 0 7 z" className="fill-violet-500" />
        </marker>
      </defs>
      {bindings.flatMap((binding) => {
        const functionPosition = positions[`function:${binding.functionId}`];
        const bindingPosition = positions[`binding:${binding.id}`];
        const endpointPosition = positions[`endpoint:${binding.endpointId}`];
        if (!functionPosition || !bindingPosition || !endpointPosition)
          return [];
        const endpointToBinding = {
          startX: endpointPosition.x + NODE_SIZE.endpoint.width,
          startY: endpointPosition.y + NODE_SIZE.endpoint.height / 2,
          endX: bindingPosition.x,
          endY: bindingPosition.y + NODE_SIZE.binding.height / 2,
        };
        const bindingToFunction = {
          startX: bindingPosition.x + NODE_SIZE.binding.width,
          startY: bindingPosition.y + NODE_SIZE.binding.height / 2,
          endX: functionPosition.x,
          endY: functionPosition.y + NODE_SIZE.function.height / 2,
        };
        return [endpointToBinding, bindingToFunction].map((edge, index) => (
          <TopologyEdge
            key={`${binding.id}:${index}`}
            {...edge}
            enabled={binding.enabled}
            kind={binding.endpointKind}
          />
        ));
      })}
      {preview && (
        <TopologyEdge
          startX={
            preview.source === "endpoint" ? preview.start.x : preview.current.x
          }
          startY={
            preview.source === "endpoint" ? preview.start.y : preview.current.y
          }
          endX={
            preview.source === "endpoint" ? preview.current.x : preview.start.x
          }
          endY={
            preview.source === "endpoint" ? preview.current.y : preview.start.y
          }
          enabled
          preview
          kind={preview.colorKind}
        />
      )}
    </svg>
  );
}

function TopologyEdge({
  startX,
  startY,
  endX,
  endY,
  enabled,
  kind,
  preview = false,
}: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  enabled: boolean;
  kind: "mcp" | "http" | undefined;
  preview?: boolean;
}) {
  const direction = endX >= startX ? 1 : -1;
  const bend = Math.max(50, Math.abs(endX - startX) * 0.45);
  const path = `M ${startX} ${startY} C ${startX + direction * bend} ${startY}, ${endX - direction * bend} ${endY}, ${endX} ${endY}`;
  return (
    <g className={enabled ? "opacity-100" : "opacity-35"}>
      <path
        d={path}
        fill="none"
        stroke="hsl(var(--background))"
        strokeWidth="7"
      />
      <path
        d={path}
        fill="none"
        markerEnd={`url(#topology-arrow-${preview && !kind ? "preview" : (kind ?? "preview")})`}
        className={
          kind === "mcp"
            ? "stroke-cyan-500"
            : kind === "http"
              ? "stroke-amber-500"
              : "stroke-violet-500"
        }
        strokeDasharray={preview ? "6 5" : enabled ? undefined : "5 5"}
        strokeWidth={preview ? "2.5" : "2"}
      />
    </g>
  );
}

function GraphLaneLabel({ x, label }: { x: number; label: string }) {
  return (
    <span
      className="pointer-events-none absolute top-7 z-[1] text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
      style={{ left: x }}
    >
      {label}
    </span>
  );
}

function ConnectDialog({
  endpoint,
  fn,
  onChanged,
  onClose,
}: {
  endpoint: MapEndpoint;
  fn: OpsFunction;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(
    endpoint.kind === "mcp" ? fn.slug : `/${fn.slug.replaceAll("_", "-")}`,
  );
  const [method, setMethod] = useState("POST");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast();
  async function connect() {
    setBusy(true);
    setError(undefined);
    try {
      await api(
        `/api/runtime-endpoints/${endpoint.id}/${endpoint.kind === "mcp" ? "mcp-bindings" : "http-bindings"}`,
        {
          method: "POST",
          body: JSON.stringify(
            endpoint.kind === "mcp"
              ? {
                  functionId: fn.id,
                  toolName: name,
                  title: fn.title,
                  description: fn.description || `Invoke ${fn.title}`,
                  enabled: true,
                }
              : {
                  functionId: fn.id,
                  method,
                  path: name,
                  inputMapping: null,
                  responseMapping: null,
                  enabled: true,
                },
          ),
        },
      );
      toast({
        title: "Function connected",
        description: "A separate binding node was added to the map.",
        tone: "success",
      });
      onClose();
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      trigger={<span className="hidden" />}
      title={`Connect ${fn.slug}`}
      description={`Create a draft binding on ${endpoint.name}.`}
    >
      <div className="space-y-4">
        {endpoint.kind === "http" && (
          <div>
            <label className="label">Method</label>
            <select
              className="field"
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">
            {endpoint.kind === "mcp" ? "Tool name" : "Route path"}
          </label>
          <input
            className="field font-mono"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <Button loading={busy} disabled={!name} onClick={() => void connect()}>
          <Link2 size={13} /> Connect Function
        </Button>
      </div>
    </Dialog>
  );
}

function flattenBindings(endpoints: MapEndpoint[]): BindingNode[] {
  return endpoints.flatMap((endpoint) => [
    ...endpoint.mcpToolBindings.map((binding) => ({
      id: binding.id,
      endpointId: endpoint.id,
      endpointKind: "mcp" as const,
      functionId: binding.functionId,
      label: binding.toolName,
      detail: binding.title,
      enabled: binding.enabled,
      raw: binding,
    })),
    ...endpoint.httpRouteBindings.map((binding) => ({
      id: binding.id,
      endpointId: endpoint.id,
      endpointKind: "http" as const,
      functionId: binding.functionId,
      label: `${binding.method} ${binding.path}`,
      detail: binding.path,
      enabled: binding.enabled,
      raw: binding,
    })),
  ]);
}

function buildDefaultLayout(
  endpoints: MapEndpoint[],
  functions: OpsFunction[],
): Layout {
  const layout: Layout = {};
  let endpointCursor = 90;
  for (const endpoint of endpoints) {
    const bindings =
      endpoint.kind === "mcp"
        ? endpoint.mcpToolBindings
        : endpoint.httpRouteBindings;
    const groupHeight = Math.max(130, bindings.length * 112);
    layout[`endpoint:${endpoint.id}`] = {
      x: 70,
      y:
        endpointCursor +
        Math.max(0, (groupHeight - NODE_SIZE.endpoint.height) / 2),
    };
    bindings.forEach((binding, index) => {
      layout[`binding:${binding.id}`] = {
        x: 580,
        y: endpointCursor + index * 112,
      };
    });
    endpointCursor += groupHeight + 70;
  }
  functions.forEach((fn, index) => {
    layout[`function:${fn.id}`] = { x: 1120, y: 90 + index * 112 };
  });
  return layout;
}

function readLayout(value: unknown): Layout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, NodePosition] =>
        !!entry[1] &&
        typeof entry[1] === "object" &&
        !Array.isArray(entry[1]) &&
        Number.isFinite((entry[1] as NodePosition).x) &&
        Number.isFinite((entry[1] as NodePosition).y),
    ),
  );
}

function nodeSize(id: string) {
  if (id.startsWith("endpoint:")) return NODE_SIZE.endpoint;
  if (id.startsWith("binding:")) return NODE_SIZE.binding;
  return NODE_SIZE.function;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
