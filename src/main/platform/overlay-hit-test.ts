export interface Point { x:number; y:number }
export interface Bounds { x:number; y:number; width:number; height:number }
/** The title bar is a native drag region and cannot always forward DOM mousemove. */
export function insideDragBar(point:Point,bounds:Bounds,titlebarHeight=32):boolean {
  return point.x>=bounds.x && point.x<bounds.x+bounds.width && point.y>=bounds.y && point.y<bounds.y+Math.min(titlebarHeight,bounds.height);
}

/** Keep the visible bottom-right resize affordance interactive while the rest of the overlay passes clicks through. */
export function insideResizeGrip(point:Point,bounds:Bounds,gripSize=24):boolean {
  return point.x>=bounds.x+bounds.width-gripSize && point.x<bounds.x+bounds.width &&
    point.y>=bounds.y+bounds.height-gripSize && point.y<bounds.y+bounds.height;
}
