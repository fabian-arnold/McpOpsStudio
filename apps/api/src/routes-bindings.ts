import { type FastifyInstance } from "fastify";
import { prisma } from "@mcpops/db";
import { httpBindingSchema, mcpBindingSchema } from "@mcpops/shared";
import { requireRole } from "./auth.js";
import { sessionContext, parse, requestId } from "./helpers.js";
import {
  validateBindingReferences,
  writeControlAudit,
} from "./api-operation-helpers.js";

export async function registerBindingsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/runtime-endpoints/:endpointId/mcp-bindings",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { endpointId } = request.params as { endpointId: string };
      const input = parse(mcpBindingSchema, request.body);
      await validateBindingReferences(
        session.projectId,
        endpointId,
        input.functionId,
        "mcp",
      );
      if (
        await prisma.mcpToolBinding.findFirst({
          where: { endpointId, toolName: input.toolName },
          select: { id: true },
        })
      )
        return reply.status(409).send({
          error: {
            code: "MCP_TOOL_NAME_CONFLICT",
            message: "This MCP tool name is already bound in the endpoint",
            requestId: requestId(request),
          },
        });
      const created = await prisma.mcpToolBinding.create({
        data: { endpointId, ...input },
      });
      await writeControlAudit(
        session,
        endpointId,
        "mcp_binding.created",
        "mcp_tool_binding",
        created.id,
        {
          toolName: created.toolName,
          functionId: created.functionId,
        },
      );
      return reply.status(201).send(created);
    },
  );
  app.post(
    "/api/runtime-endpoints/:endpointId/http-bindings",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { endpointId } = request.params as { endpointId: string };
      const input = parse(httpBindingSchema, request.body);
      await validateBindingReferences(
        session.projectId,
        endpointId,
        input.functionId,
        "http",
      );
      if (
        await prisma.httpRouteBinding.findFirst({
          where: { endpointId, method: input.method, path: input.path },
          select: { id: true },
        })
      )
        return reply.status(409).send({
          error: {
            code: "HTTP_ROUTE_CONFLICT",
            message: "This HTTP method and path are already bound in the endpoint",
            requestId: requestId(request),
          },
        });
      const created = await prisma.httpRouteBinding.create({
        data: { endpointId, ...input } as never,
      });
      await writeControlAudit(
        session,
        endpointId,
        "http_binding.created",
        "http_route_binding",
        created.id,
        {
          method: created.method,
          path: created.path,
          functionId: created.functionId,
        },
      );
      return reply.status(201).send(created);
    },
  );
  app.patch(
    "/api/runtime-endpoints/:endpointId/mcp-bindings/:bindingId",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { endpointId, bindingId } = request.params as {
        endpointId: string;
        bindingId: string;
      };
      const input = parse(mcpBindingSchema.partial().strict(), request.body);
      const owned = await prisma.mcpToolBinding.findFirst({
        where: {
          id: bindingId,
          endpoint: { id: endpointId, projectId: session.projectId },
        },
      });
      if (!owned)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Binding not found",
            requestId: requestId(request),
          },
        });
      await validateBindingReferences(
        session.projectId,
        endpointId,
        input.functionId ?? owned.functionId,
        "mcp",
      );
      const toolName = input.toolName ?? owned.toolName;
      if (
        await prisma.mcpToolBinding.findFirst({
          where: { endpointId, toolName, id: { not: bindingId } },
          select: { id: true },
        })
      )
        return reply.status(409).send({
          error: {
            code: "MCP_TOOL_NAME_CONFLICT",
            message: "This MCP tool name is already bound in the endpoint",
            requestId: requestId(request),
          },
        });
      const updated = await prisma.mcpToolBinding.update({
        where: { id: bindingId },
        data: input,
      });
      await writeControlAudit(
        session,
        endpointId,
        "mcp_binding.updated",
        "mcp_tool_binding",
        bindingId,
        {
          toolName: updated.toolName,
          functionId: updated.functionId,
        },
      );
      return updated;
    },
  );
  app.patch(
    "/api/runtime-endpoints/:endpointId/http-bindings/:bindingId",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { endpointId, bindingId } = request.params as {
        endpointId: string;
        bindingId: string;
      };
      const input = parse(httpBindingSchema.partial().strict(), request.body);
      const owned = await prisma.httpRouteBinding.findFirst({
        where: {
          id: bindingId,
          endpoint: { id: endpointId, projectId: session.projectId },
        },
      });
      if (!owned)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Binding not found",
            requestId: requestId(request),
          },
        });
      await validateBindingReferences(
        session.projectId,
        endpointId,
        input.functionId ?? owned.functionId,
        "http",
      );
      const method = input.method ?? owned.method;
      const path = input.path ?? owned.path;
      if (
        await prisma.httpRouteBinding.findFirst({
          where: { endpointId, method, path, id: { not: bindingId } },
          select: { id: true },
        })
      )
        return reply.status(409).send({
          error: {
            code: "HTTP_ROUTE_CONFLICT",
            message: "This HTTP method and path are already bound in the endpoint",
            requestId: requestId(request),
          },
        });
      const updated = await prisma.httpRouteBinding.update({
        where: { id: bindingId },
        data: input as never,
      });
      await writeControlAudit(
        session,
        endpointId,
        "http_binding.updated",
        "http_route_binding",
        bindingId,
        {
          method: updated.method,
          path: updated.path,
          functionId: updated.functionId,
        },
      );
      return updated;
    },
  );
  app.delete(
    "/api/runtime-endpoints/:endpointId/mcp-bindings/:bindingId",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { endpointId, bindingId } = request.params as {
        endpointId: string;
        bindingId: string;
      };
      const owned = await prisma.mcpToolBinding.findFirst({
        where: {
          id: bindingId,
          endpoint: { id: endpointId, projectId: session.projectId },
        },
      });
      if (!owned)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Binding not found",
            requestId: requestId(request),
          },
        });
      await prisma.mcpToolBinding.delete({ where: { id: bindingId } });
      await writeControlAudit(
        session,
        endpointId,
        "mcp_binding.deleted",
        "mcp_tool_binding",
        bindingId,
        {
          toolName: owned.toolName,
        },
      );
      return reply.status(204).send();
    },
  );
  app.delete(
    "/api/runtime-endpoints/:endpointId/http-bindings/:bindingId",
    async (request, reply) => {
      const session = sessionContext(request);
      requireRole(session, ["owner", "admin", "developer"]);
      const { endpointId, bindingId } = request.params as {
        endpointId: string;
        bindingId: string;
      };
      const owned = await prisma.httpRouteBinding.findFirst({
        where: {
          id: bindingId,
          endpoint: { id: endpointId, projectId: session.projectId },
        },
      });
      if (!owned)
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Binding not found",
            requestId: requestId(request),
          },
        });
      await prisma.httpRouteBinding.delete({ where: { id: bindingId } });
      await writeControlAudit(
        session,
        endpointId,
        "http_binding.deleted",
        "http_route_binding",
        bindingId,
        {
          method: owned.method,
          path: owned.path,
        },
      );
      return reply.status(204).send();
    },
  );
}
