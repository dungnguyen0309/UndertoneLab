import { MinusIcon, PlusIcon } from "../components/icons";
import type { Stage } from "./stage";

/** + and − in the top-right corner of a 3D view that zooms: the way in for a mouse without Ctrl, and for the
 *  keyboard. The view's parent must be positioned. */
export default function ZoomButtons({ stage }: { stage: Stage | null }) {
  if (stage && !stage.zoomable) return null;
  return (
    <div className="zoom-buttons" role="group" aria-label="Zoom">
      <button type="button" className="btn small" aria-label="Zoom in" title="Zoom in (Ctrl + scroll also zooms)"
        disabled={!stage} onClick={() => stage?.zoomBy(0.75)}><PlusIcon /></button>
      <button type="button" className="btn small" aria-label="Zoom out" title="Zoom out (Ctrl + scroll also zooms)"
        disabled={!stage} onClick={() => stage?.zoomBy(1 / 0.75)}><MinusIcon /></button>
    </div>
  );
}
