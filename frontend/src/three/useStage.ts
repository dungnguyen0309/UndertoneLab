import { type RefObject, useEffect, useState } from "react";
import { createStage, type Stage, webglAvailable } from "./stage";

/** Create a three.js stage in a container for the lifetime of a component. */
export function useStage(ref: RefObject<HTMLDivElement | null>, options: Parameters<typeof createStage>[1]) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    if (!webglAvailable()) {
      setFailed(true);
      return;
    }
    const created = createStage(ref.current, options);
    setStage(created);
    return () => {
      setStage(null);
      created.dispose();
    };
    // the options are fixed for a component's lifetime
  }, [ref]);
  return { stage, failed };
}
