/**
 * Line icons drawn to match the CAD aesthetic: 1px strokes on a 16px grid.
 *
 * Hand-rolled rather than pulled from an icon library to keep dependencies
 * minimal and the visual language consistent with the drawing area.
 */

interface IconProps {
  className?: string;
}

function Svg({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const OpenIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M1.5 4.5h4l1.5 2h7.5v7H1.5z" />
    <path d="M1.5 4.5v-2h3l1 1.5" />
  </Svg>
);

export const SaveIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M2.5 2.5h8l3 3v8h-11z" />
    <path d="M5 2.5v4h5v-4M5 13.5v-4h6v4" />
  </Svg>
);

export const ZoomExtentsIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
    <rect x="5.5" y="5.5" width="5" height="5" />
  </Svg>
);

export const ZoomInIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="6.75" cy="6.75" r="4.25" />
    <path d="M10 10l3.5 3.5M4.75 6.75h4M6.75 4.75v4" />
  </Svg>
);

export const ZoomOutIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="6.75" cy="6.75" r="4.25" />
    <path d="M10 10l3.5 3.5M4.75 6.75h4" />
  </Svg>
);

export const PanIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M8 1.5v13M1.5 8h13" />
    <path d="M8 1.5L6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" />
  </Svg>
);

export const SelectIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M3.5 2l8.5 6-4 1 2.5 4-2 1-2.5-4-2.5 2.5z" />
  </Svg>
);

export const GridIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M2 2h12v12H2z" />
    <path d="M6 2v12M10 2v12M2 6h12M2 10h12" />
  </Svg>
);

export const SnapIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M2 8h4M10 8h4M8 2v4M8 10v4" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
);

export const LayersIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M8 1.5l6 3-6 3-6-3z" />
    <path d="M2 8l6 3 6-3M2 11l6 3 6-3" />
  </Svg>
);

export const EyeIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" />
    <circle cx="8" cy="8" r="1.75" />
  </Svg>
);

export const EyeOffIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M2.5 5.5C1.6 6.6 1 8 1 8s2.5 4.5 7 4.5c1 0 1.9-.2 2.7-.5" />
    <path d="M6.2 3.7c.6-.1 1.2-.2 1.8-.2 4.5 0 7 4.5 7 4.5s-.6 1.1-1.6 2.2" />
    <path d="M2 2l12 12" />
  </Svg>
);

export const LockIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <rect x="3.5" y="7" width="9" height="6.5" />
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
  </Svg>
);

export const WarningIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M8 2l6 11H2z" />
    <path d="M8 6.5v3M8 11.2v.3" />
  </Svg>
);

export const InfoIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.25v3.75M8 5.2v.3" />
  </Svg>
);

export const CloseIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const IsolateIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
  </Svg>
);
