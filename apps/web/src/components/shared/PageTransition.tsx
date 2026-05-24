interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A quick entrance beat for a screen's content — a fade and slight rise on
 * mount. Subtle and cheap; wraps ~19 screens.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <div
      className={`h-full animate-in fade-in slide-in-from-bottom duration-200 ${
        className ?? ""
      }`}
    >
      {children}
    </div>
  );
}
