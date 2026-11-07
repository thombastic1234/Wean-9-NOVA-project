"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useOrders } from "@/components/OrderProvider";
import { fallbackRanking, makePriorityRequest, MAX_AI_ORDERS } from "./priority";
import { requestPriority } from "./priorityClient";

export function usePriority() {
  const { state, dispatch } = useOrders();
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<{ version: number; message: string } | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; inFlight.current?.abort(); };
  }, []);

  // The store increments this version for every queued-input/settings change.
  // Packing/status updates outside the queue must not trigger reranking. No clock-driven API requests.
  const local = useMemo(() => fallbackRanking(makePriorityRequest(state.orders, state.settings, state.priorityVersion)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.priorityVersion]);
  const ranking = state.ranking ?? local;

  async function reprioritize() {
    if (!state.hydrated || inFlight.current || !state.orders.some(order => order.status === "queued")) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setFailure(null);
    // Refresh durations and version for this explicit request. No effect triggers another call.
    const request = makePriorityRequest(state.orders, state.settings, state.priorityVersion + 1);
    dispatch({ type: "refresh_priority" });
    try {
      const outcome = await requestPriority(request, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      dispatch({ type: "ranking", response: outcome.response });
      if (outcome.error) setFailure({ version: request.requestVersion, message: outcome.error });
    } finally {
      inFlight.current = null;
      if (mounted.current) setLoading(false);
    }
  }

  return {
    ranking, loading, reprioritize,
    error: failure?.version === state.priorityVersion ? failure.message : null,
    overAiLimit: local.ranking.length > MAX_AI_ORDERS,
  };
}
