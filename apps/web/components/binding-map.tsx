"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Check, RefreshCw, RotateCcw } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { roleAllows, useCurrentUser } from "@/lib/session";
import type { OpsFunction } from "@/lib/types";
import { useToast } from "@/components/providers";
import { Button, LoadError, Skeleton } from "@/components/ui";

import { ConnectDialog } from "./binding-map-dialog";
import {
  buildDefaultLayout,
  clamp,
  flattenBindings,
  nodeSize,
  readLayout,
} from "./binding-map-layout";
import {
  BindingNodeCard,
  EndpointNode,
  FunctionNode,
  GraphLaneLabel,
  GraphEdges,
  MovableNode,
} from "./binding-map-nodes";
import {
  NODE_SIZE,
  type BindingMapResponse,
  type ConnectionPreview,
  type Layout,
  type MapEndpoint,
  type NodePosition,
  type PendingConnection,
} from "./binding-map-types";

export function BindingMap({ functions }: { functions: OpsFunction[] }) {
  const [endpoints, setEndpoints] = useState<MapEndpoint[]>();
  const [positions, setPositions] = useState<Layout>({});
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [activeNode, setActiveNode] = useState<string>();
  const [connectionPreview, setConnectionPreview] = useState<ConnectionPreview>();
  const [pendingConnection, setPendingConnection] = useState<PendingConnection>();
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
      ? (endpoints ?? []).find((endpoint) => endpoint.id === target.dataset.endpointId)
      : undefined;
  }

  function functionConnectionTarget(clientX: number, clientY: number) {
    const target = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-function-id]");
    return target
      ? functions.find((fn) => fn.id === target.dataset.functionId && fn.enabled)
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
      const fn = functions.find((candidate) => candidate.id === preview.functionId);
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
            Connect in either direction between a service and Function. Use the grip to
            move nodes.
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
                  onConnectionStart={(event) => startFunctionConnection(fn, event)}
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
        Positions are shared with the Project. Binding changes remain drafts until the
        Project is deployed.
      </p>
    </div>
  );
}
