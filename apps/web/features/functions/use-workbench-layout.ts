"use client";

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

import { clampPanelSize, readWorkbenchLayout } from "./function-workbench-components";
import {
  defaultWorkbenchLayout,
  type WorkbenchPanel,
} from "./function-workbench-types";

export function useWorkbenchLayout() {
  const [workbenchLayout, setWorkbenchLayout] = useState(defaultWorkbenchLayout);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setWorkbenchLayout(
      readWorkbenchLayout(localStorage.getItem("mcpops:function-workbench-layout")),
    );
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated)
      localStorage.setItem(
        "mcpops:function-workbench-layout",
        JSON.stringify(workbenchLayout),
      );
  }, [hydrated, workbenchLayout]);

  function resizePanel(panel: WorkbenchPanel, delta: number) {
    setWorkbenchLayout((current) => ({
      ...current,
      [panel]: clampPanelSize(panel, current[panel] + delta),
    }));
  }

  function startPanelResize(panel: WorkbenchPanel, event: ReactPointerEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = workbenchLayout[panel];
    document.body.style.userSelect = "none";
    document.body.style.cursor = panel === "bottom" ? "row-resize" : "col-resize";
    const move = (moveEvent: PointerEvent) => {
      const delta =
        panel === "left"
          ? moveEvent.clientX - startX
          : panel === "right"
            ? startX - moveEvent.clientX
            : startY - moveEvent.clientY;
      setWorkbenchLayout((current) => ({
        ...current,
        [panel]: clampPanelSize(panel, initial + delta),
      }));
    };
    const stop = () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return { workbenchLayout, setWorkbenchLayout, resizePanel, startPanelResize };
}
