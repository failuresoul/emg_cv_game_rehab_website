import { useMemo } from "react";

import { useSession } from "@/features/session/SessionContext";

import { gripRefsFromWarmup } from "./cvGripSource";
import { type ActivationValue, useActivation } from "./useActivation";

/**
 * useActivation for the session pages: the affected side and the grip references come from the
 * session, using this session's hand open-close warm-up when there is one.
 */
export function useSessionActivation(liveLevel = true): ActivationValue {
  const { affectedSide, warmupResults } = useSession();
  const refs = useMemo(() => gripRefsFromWarmup(warmupResults), [warmupResults]);
  return useActivation({ affectedSide, refs, liveLevel });
}
