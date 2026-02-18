import type { FC, PropsWithChildren } from "react";
import React, { useLayoutEffect, useRef } from "react";

export type CollapseProps = PropsWithChildren<{
  expanded: boolean;
  id: string;
}>;

export const Collapse: FC<CollapseProps> = ({
  id,
  children,
  expanded = false,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const instant = useRef(true);
  const transition = "height 250ms ease-out";

  const openCollapse = () => {
    const node = ref.current;
    if (!node) return;

    requestAnimationFrame(() => {
      node.style.height = node.scrollHeight + "px";
    });
  };

  const closeCollapse = () => {
    const node = ref.current;
    if (!node) return;

    requestAnimationFrame(() => {
      node.style.height = node.offsetHeight + "px";
      node.style.overflow = "hidden";
      requestAnimationFrame(() => {
        node.style.height = "0";
      });
    });
  };

  useLayoutEffect(() => {
    if (expanded) {
      openCollapse();
    } else {
      closeCollapse();
    }
  }, [expanded]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    function handleComplete() {
      if (!node) return;

      node.style.overflow = expanded ? "" : "hidden";
      if (expanded) {
        node.style.height = "auto";
      }
    }

    function handleTransitionEnd(event: TransitionEvent) {
      if (node && event.target === node && event.propertyName === "height") {
        handleComplete();
      }
    }

    if (instant.current) {
      handleComplete();
      instant.current = false;
    }

    node.addEventListener("transitionend", handleTransitionEnd);
    return () => node.removeEventListener("transitionend", handleTransitionEnd);
  }, [expanded]);

  return (
    <div
      className="my-5 flex justify-between w-md overflow-x-scroll space-x-4 transition-all duration-200 scrollbar-bg"
      id={id}
      ref={ref}
      role="region"
      style={{
        height: 0,
        transition: instant.current ? undefined : transition,
        // overflow: "unset"
      }}
    >
      {children}
    </div>
  );
};
