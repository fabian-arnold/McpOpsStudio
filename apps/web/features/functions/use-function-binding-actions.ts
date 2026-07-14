"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import type { EditableFunctionBinding } from "@/components/binding-editor-dialog";
import type { useToast } from "@/components/providers";
import { api, errorMessage } from "@/lib/api";
import type { FunctionDetail, OpsFunction } from "@/lib/types";

type BindingActionsOptions = {
  fn: FunctionDetail | undefined;
  setFn: Dispatch<SetStateAction<FunctionDetail | undefined>>;
  setFunctions: Dispatch<SetStateAction<OpsFunction[]>>;
  toast: ReturnType<typeof useToast>;
};

export function useFunctionBindingActions({
  fn,
  setFn,
  setFunctions,
  toast,
}: BindingActionsOptions) {
  const [bindingBusyId, setBindingBusyId] = useState<string>();
  const [deploying, setDeploying] = useState(false);

  async function refreshFunctionMetadata() {
    if (!fn) return;
    const [current, allFunctions] = await Promise.all([
      api<FunctionDetail>(`/api/functions/${fn.id}`),
      api<OpsFunction[]>("/api/functions"),
    ]);
    setFn(current);
    setFunctions(allFunctions);
  }

  async function toggleBinding(binding: EditableFunctionBinding) {
    setBindingBusyId(binding.id);
    try {
      await api(
        `/api/runtime-endpoints/${binding.endpointId}/${binding.kind === "mcp" ? "mcp-bindings" : "http-bindings"}/${binding.id}`,
        { method: "PATCH", body: JSON.stringify({ enabled: !binding.enabled }) },
      );
      await refreshFunctionMetadata();
    } catch (error) {
      toast({
        title: "Binding was not changed",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setBindingBusyId(undefined);
    }
  }

  async function removeBinding(binding: EditableFunctionBinding) {
    if (
      !window.confirm(
        "Remove this binding? Runtime traffic remains unchanged until the Project is deployed.",
      )
    )
      return;
    setBindingBusyId(binding.id);
    try {
      await api(
        `/api/runtime-endpoints/${binding.endpointId}/${binding.kind === "mcp" ? "mcp-bindings" : "http-bindings"}/${binding.id}`,
        { method: "DELETE" },
      );
      await refreshFunctionMetadata();
      toast({
        title: "Binding removed",
        description: "Deploy the Project to publish this change.",
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Binding was not removed",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setBindingBusyId(undefined);
    }
  }

  async function deploy() {
    setDeploying(true);
    try {
      await api("/api/deployments", { method: "POST", body: "{}" });
      toast({
        title: "Development deployment queued",
        description:
          "All saved Function and binding changes will be built as one immutable Project snapshot.",
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Deployment was not queued",
        description: errorMessage(error),
        tone: "error",
      });
    } finally {
      setDeploying(false);
    }
  }

  return {
    bindingBusyId,
    deploying,
    refreshFunctionMetadata,
    toggleBinding,
    removeBinding,
    deploy,
  };
}
