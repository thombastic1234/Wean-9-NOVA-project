"use client";

import { useEffect } from "react";
import { useOrders } from "@/components/OrderProvider";
import { priorityResponseSchema, type PriorityRequest } from "./contracts";

export function usePriority() {
  const { state, dispatch } = useOrders();
  useEffect(() => {
    if (!state.hydrated) return;
    const timer = setInterval(() => dispatch({ type: "refresh_priority" }), 30_000);
    return () => clearInterval(timer);
  }, [state.hydrated, dispatch]);

  useEffect(() => {
    if (!state.hydrated) return;
    const controller = new AbortController();
    let active = true;
    const queued = state.orders.filter(o => o.status === "queued");
    const now = Date.now();
    const request: PriorityRequest = {
      requestVersion: state.priorityVersion, settings: state.settings,
      orders: queued.map(o => ({
        orderId: o.id, fulfillment: o.fulfillment, ageMinutes: Math.max(0, (now - Date.parse(o.createdAt)) / 60_000),
        estimatedPrepMinutes: o.estimatedPrepMinutes, minutesUntilTargetReady: (Date.parse(o.targetReadyAt) - now) / 60_000,
        courierWaitingMinutes: o.courierArrivedAt ? Math.max(0, (now - Date.parse(o.courierArrivedAt)) / 60_000) : 0,
      })),
    };
    const timer = setTimeout(() => controller.abort(), 8_000);
    async function load() {
      try {
        const response = await fetch("/api/prioritize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.signal });
        if (!response.ok) throw new Error("Prioritization unavailable");
        const result = priorityResponseSchema.parse(await response.json());
        const ids = result.ranking.map(row => row.orderId);
        if (result.requestVersion !== request.requestVersion || ids.length !== queued.length || new Set(ids).size !== ids.length || queued.some(o => !ids.includes(o.id))) throw new Error("Incomplete ranking");
        if (active) dispatch({ type: "ranking", response: result });
      } catch {
        // Person 1's outage adapter preserves incoming order. Person 2 owns the actual fallback algorithm.
        if (active) dispatch({ type: "ranking", response: { requestVersion: request.requestVersion, mode: "fallback", ranking: queued.map(o => ({ orderId: o.id, reason: "Incoming order · priority service unavailable" })) } });
      } finally { clearTimeout(timer); }
    }
    void load();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
    // Changes to queued membership, relevant fields, settings, or clock refresh increment this version in the reducer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated, state.priorityVersion, dispatch]);
}
