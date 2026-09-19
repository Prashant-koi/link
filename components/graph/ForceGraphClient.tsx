"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { forwardRef } from "react";
import ForceGraph2D from "react-force-graph-2d";

/**
 * next/dynamic does not forward a ref to the loaded component, and the graph
 * instance is the only way to configure d3 forces or call zoomToFit. Wrapping
 * it in an explicit forwardRef — and dynamically importing *this* module —
 * keeps the library client-only while still handing back the instance.
 */
const ForceGraphClient = forwardRef<any, any>(function ForceGraphClient(props, ref) {
  // the library types ref as a MutableRefObject; a callback ref works at
  // runtime (it goes through useImperativeHandle) but not in its types
  return <ForceGraph2D ref={ref as any} {...props} />;
});

export default ForceGraphClient;
