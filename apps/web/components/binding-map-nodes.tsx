"use client";
/* eslint-disable max-lines -- map node renderers share topology geometry and styles */

import Link from "next/link";
import {
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Braces,
  CalendarClock,
  Globe2,
  Grip,
  Route,
  Server,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { OpsFunction } from "@/lib/types";
import { useToast } from "@/components/providers";
import { Badge, Button } from "@/components/ui";
import {
  NODE_SIZE,
  type BindingNode,
  type ConnectionPreview,
  type Layout,
  type MapEndpoint,
  type MapCronBinding,
  type NodePosition,
} from "./binding-map-types";

export function MovableNode({
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

export function EndpointNode({
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
        const functionId = event.dataTransfer.getData("application/x-mcpops-function");
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
          {endpoint.kind === "mcp" ? <Server size={16} /> : <Globe2 size={16} />}
        </span>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {endpoint.kind === "mcp" ? "MCP service" : "HTTP service"}
          </p>
          <Link
            href={`/endpoints/${endpoint.id}?tab=bindings`}
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

export function BindingNodeCard({
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
    if (!window.confirm("Remove this binding from the development configuration?"))
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
          <code className="block truncate text-xs font-semibold">{binding.label}</code>
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

export function FunctionNode({
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
        <span className="text-[10px] text-muted-foreground">{fn.riskLevel}</span>
      </div>
    </div>
  );
}

export function CronNodeCard({
  binding,
  fn,
}: {
  binding: MapCronBinding;
  fn?: OpsFunction;
}) {
  return (
    <div className="relative size-full rounded-xl border border-emerald-500/35 bg-emerald-500/[.045] p-3 pr-10">
      <span className="absolute -right-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-card bg-emerald-500" />
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <CalendarClock size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cron schedule
          </p>
          <Link
            href={`/schedules?bindingId=${binding.id}`}
            className="block truncate text-xs font-semibold hover:text-primary"
          >
            {binding.name}
          </Link>
        </div>
      </div>
      <p className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
        {binding.expression} · {binding.timezone}
      </p>
      <p className="truncate text-[10px] text-muted-foreground">
        {binding.environment.name} · {fn?.slug ?? "Unknown Function"}
      </p>
    </div>
  );
}

export function GraphEdges({
  width,
  height,
  bindings,
  positions,
  preview,
  schedules = [],
}: {
  width: number;
  height: number;
  bindings: BindingNode[];
  positions: Layout;
  preview: ConnectionPreview | undefined;
  schedules?: MapCronBinding[];
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
        <marker
          id="topology-arrow-cron"
          markerHeight="7"
          markerWidth="7"
          orient="auto"
          refX="6"
          refY="3.5"
        >
          <path d="M 0 0 L 7 3.5 L 0 7 z" className="fill-emerald-500" />
        </marker>
      </defs>
      {bindings.flatMap((binding) => {
        const functionPosition = positions[`function:${binding.functionId}`];
        const bindingPosition = positions[`binding:${binding.id}`];
        const endpointPosition = positions[`endpoint:${binding.endpointId}`];
        if (!functionPosition || !bindingPosition || !endpointPosition) return [];
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
      {schedules.map((binding) => {
        const schedulePosition = positions[`schedule:${binding.id}`];
        const functionPosition = positions[`function:${binding.functionId}`];
        if (!schedulePosition || !functionPosition) return null;
        return (
          <TopologyEdge
            key={`schedule:${binding.id}`}
            startX={schedulePosition.x + NODE_SIZE.schedule.width}
            startY={schedulePosition.y + NODE_SIZE.schedule.height / 2}
            endX={functionPosition.x}
            endY={functionPosition.y + NODE_SIZE.function.height / 2}
            enabled={binding.enabled}
            kind="cron"
          />
        );
      })}
      {preview && (
        <TopologyEdge
          startX={preview.source === "endpoint" ? preview.start.x : preview.current.x}
          startY={preview.source === "endpoint" ? preview.start.y : preview.current.y}
          endX={preview.source === "endpoint" ? preview.current.x : preview.start.x}
          endY={preview.source === "endpoint" ? preview.current.y : preview.start.y}
          enabled
          preview
          kind={preview.colorKind}
        />
      )}
    </svg>
  );
}

export function TopologyEdge({
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
  kind: "mcp" | "http" | "cron" | undefined;
  preview?: boolean;
}) {
  const direction = endX >= startX ? 1 : -1;
  const bend = Math.max(50, Math.abs(endX - startX) * 0.45);
  const path = `M ${startX} ${startY} C ${startX + direction * bend} ${startY}, ${endX - direction * bend} ${endY}, ${endX} ${endY}`;
  return (
    <g className={enabled ? "opacity-100" : "opacity-35"}>
      <path d={path} fill="none" stroke="hsl(var(--background))" strokeWidth="7" />
      <path
        d={path}
        fill="none"
        markerEnd={`url(#topology-arrow-${preview && !kind ? "preview" : (kind ?? "preview")})`}
        className={
          kind === "mcp"
            ? "stroke-cyan-500"
            : kind === "http"
              ? "stroke-amber-500"
              : kind === "cron"
                ? "stroke-emerald-500"
                : "stroke-violet-500"
        }
        strokeDasharray={preview ? "6 5" : enabled ? undefined : "5 5"}
        strokeWidth={preview ? "2.5" : "2"}
      />
    </g>
  );
}

export function GraphLaneLabel({ x, label }: { x: number; label: string }) {
  return (
    <span
      className="pointer-events-none absolute top-7 z-[1] text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"
      style={{ left: x }}
    >
      {label}
    </span>
  );
}
