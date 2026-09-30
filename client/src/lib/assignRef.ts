import type { ForwardedRef } from 'react';

/**
 * Points a forwarded ref of either shape at `node`, so a component can hold
 * its own ref to an element that its caller also needs, such as the input
 * `react-hook-form`'s `register` reads.
 */
export function assignRef<T>(ref: ForwardedRef<T>, node: T | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}
