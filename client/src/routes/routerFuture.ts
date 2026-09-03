/**
 * Opting into the v7 behaviours now keeps the console clean and means the router
 * upgrade is not a behavioural change later: state updates are wrapped in
 * `startTransition`, and relative paths inside the splat route resolve the v7 way.
 */
export const ROUTER_FUTURE = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;
