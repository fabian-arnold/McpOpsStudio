"use client";

import { FunctionWorkbenchView } from "@/features/functions/function-workbench-view";
import { useFunctionWorkbenchModel } from "@/features/functions/use-function-workbench";

export default function FunctionWorkbench() {
  const model = useFunctionWorkbenchModel();
  return <FunctionWorkbenchView model={model} />;
}
