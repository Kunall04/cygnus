import React, { useState } from "react";
import { FadeUp, SectionLabel } from "./LandingHelpers";

// ─── Step Highlights Mapping ────────────────────────────────────────────────
const stepHighlights: Record<string, { nodes: string[]; edges: string[] }> = {
  "01": {
    nodes: ["frontend", "uploader"],
    edges: ["submit"],
  },
  "02": {
    nodes: ["uploader", "s3"],
    edges: ["save-source"],
  },
  "03": {
    nodes: ["uploader", "sqs", "worker", "redis"],
    edges: ["enqueue", "receive", "read-status", "update-status"],
  },
  "04": {
    nodes: ["worker", "fargate", "s3", "preview"],
    edges: ["launch-task", "build-files", "read-preview"],
  },
};

// ─── SVG Feather Icons ──────────────────────────────────────────────────────
const Icons = {
  Frontend: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" strokeLinecap="round" />
      <path d="M12 17v4" strokeLinecap="round" />
    </svg>
  ),
  Uploader: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="17 8 12 3 7 8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="3" x2="12" y2="15" strokeLinecap="round" />
    </svg>
  ),
  Queue: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7 9h10M7 15h7" strokeLinecap="round" />
    </svg>
  ),
  Redis: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
    </svg>
  ),
  S3: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Worker: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 9h6v6H9z" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" strokeLinecap="round" />
    </svg>
  ),
  Fargate: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <polyline points="7 8 11 12 7 16" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="13" y1="16" x2="17" y2="16" strokeLinecap="round" />
    </svg>
  ),
  Router: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M12 8v4M12 12H5v4M12 12h7v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ─── Pipeline Steps ──────────────────────────────────────────────────────────
export function PipelineSteps({
  hoveredStep,
  setHoveredStep,
}: {
  hoveredStep: string | null;
  setHoveredStep: (step: string | null) => void;
}) {
  const steps = [
    { num: "01", title: "Paste URL", desc: "Drop your GitHub repository URL into the deploy form.", icon: "⬡" },
    { num: "02", title: "Clone & Upload", desc: "Cygnus clones the repo and uploads source files to Amazon S3 storage.", icon: "◈" },
    { num: "03", title: "Queue Build", desc: "The deployment ID goes to SQS. Redis tracks status and logs.", icon: "⟳" },
    { num: "04", title: "Build & Ship", desc: "Workers run npm install + build, then upload artifacts. Your site goes live.", icon: "▣" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12 }}>
      {steps.map((step, i) => {
        const isActive = hoveredStep === step.num;
        return (
          <FadeUp key={step.num} delay={i * 0.08}>
            <div
              onMouseEnter={() => setHoveredStep(step.num)}
              onMouseLeave={() => setHoveredStep(null)}
              style={{
                borderRadius: 14,
                border: isActive ? "1px solid var(--primary)" : "1px solid var(--border-card)",
                background: isActive ? "var(--primary-glow)" : "var(--bg-card)",
                padding: 6,
                minHeight: 192,
                transform: isActive ? "translateY(-4px)" : "none",
                boxShadow: isActive ? "0 8px 30px rgb(var(--accent-rgb) / 0.08)" : "none",
                transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                cursor: "pointer",
              }}
            >
              <div
                style={{
                  borderRadius: 8,
                  border: isActive ? "1px solid var(--primary-dim)" : "1px solid var(--border-card)",
                  background: "var(--bg-card-inner)",
                  padding: 20,
                  height: "100%",
                  minHeight: 176,
                  transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      letterSpacing: "0.2em",
                      color: isActive ? "var(--primary)" : "var(--text-muted)",
                      textTransform: "uppercase",
                      transition: "color 0.3s ease",
                    }}
                  >
                    Step {step.num}
                  </span>
                  <span style={{ fontSize: 18, color: isActive ? "var(--primary)" : "var(--text-faint)", transition: "color 0.3s ease" }}>
                    {step.icon}
                  </span>
                </div>
                <h3
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    marginBottom: 8,
                    fontFamily: "var(--font-body)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {step.title}
                </h3>
                <p style={{ fontSize: 13, lineHeight: 1.65, color: isActive ? "var(--text-secondary)" : "var(--text-muted)", transition: "color 0.3s ease" }}>
                  {step.desc}
                </p>
              </div>
            </div>
          </FadeUp>
        );
      })}
    </div>
  );
}

// ─── Interactive SVG Architecture Diagram ───────────────────────────────────
export function ArchitectureDiagram({
  hoveredStep,
  setHoveredStep,
}: {
  hoveredStep: string | null;
  setHoveredStep: (step: string | null) => void;
}) {
  const activeNodes = hoveredStep ? stepHighlights[hoveredStep]?.nodes || [] : [];
  const activeEdges = hoveredStep ? stepHighlights[hoveredStep]?.edges || [] : [];

  const isNodeActive = (nodeId: string) => activeNodes.includes(nodeId);
  const isEdgeActive = (edgeId: string) => activeEdges.includes(edgeId);

  const Node = ({
    id,
    x,
    y,
    width,
    height,
    title,
    subtext,
    icon,
    stepId,
  }: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title: string;
    subtext: string;
    icon: React.ReactNode;
    stepId: string;
  }) => {
    const isActive = isNodeActive(id);
    return (
      <g
        onMouseEnter={() => setHoveredStep(stepId)}
        onMouseLeave={() => setHoveredStep(null)}
        style={{ cursor: "pointer" }}
      >
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={12}
          fill={isActive ? "var(--primary-glow)" : "#102018"}
          stroke={isActive ? "var(--primary)" : "#315043"}
          strokeWidth={isActive ? 1.5 : 1}
          style={{
            transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
        {isActive && (
          <rect
            x={x + 1}
            y={y + 1}
            width={width - 2}
            height={3}
            rx={1.5}
            fill="var(--primary)"
          />
        )}
        <g transform={`translate(${x + 16}, ${y + (height - 20) / 2})`} style={{ color: isActive ? "var(--primary)" : "var(--text-muted)", transition: "color 0.3s" }}>
          {icon}
        </g>
        <text
          x={x + 48}
          y={y + 24}
          fill="var(--text-primary)"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 13,
            fontWeight: 600,
            userSelect: "none",
          }}
        >
          {title}
        </text>
        <text
          x={x + 48}
          y={y + 40}
          fill="var(--text-muted)"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            userSelect: "none",
          }}
        >
          {subtext}
        </text>
      </g>
    );
  };

  const FlowLine = ({
    id,
    path,
    label,
    labelX,
    labelY,
    reverse = false,
  }: {
    id: string;
    path: string;
    label?: string;
    labelX?: number;
    labelY?: number;
    reverse?: boolean;
  }) => {
    const isActive = isEdgeActive(id);
    return (
      <g>
        <path
          d={path}
          fill="none"
          stroke={isActive ? "rgb(var(--accent-rgb) / 0.65)" : "#527264"}
          strokeWidth={isActive ? 2 : 1}
          style={{
            transition: "all 0.3s ease",
          }}
          markerEnd={isActive ? "url(#arrow-active)" : "url(#arrow)"}
        />
        {isActive && (
          <path
            d={path}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2}
            className={reverse ? "flow-line-reverse" : "flow-line"}
            strokeLinecap="round"
          />
        )}
        {label && labelX && labelY && (
          <g style={{ transition: "opacity 0.3s ease" }}>
            <rect
              x={labelX - (label.length * 4.5) / 2 - 8}
              y={labelY - 9}
              width={label.length * 4.5 + 16}
              height={16}
              rx={4}
              fill="#0e1913"
              stroke={isActive ? "rgb(var(--accent-rgb) / 0.35)" : "#2b4438"}
              strokeWidth={1}
              style={{ transition: "all 0.3s ease" }}
            />
            <text
              x={labelX}
              y={labelY + 2}
              textAnchor="middle"
              fill={isActive ? "var(--primary)" : "var(--text-muted)"}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                letterSpacing: "0.02em",
                fontWeight: isActive ? 600 : 400,
                userSelect: "none",
                transition: "fill 0.3s ease",
              }}
            >
              {label}
            </text>
          </g>
        )}
      </g>
    );
  };

  return (
    <div className="architecture-panel">
      <svg
        role="img"
        aria-label="Cygnus deploy flow from the dashboard through SQS and Fargate to S3. Redis tracks deployment state."
        viewBox="0 0 1024 375"
        style={{
          width: "100%",
          minWidth: 900,
          height: "auto",
          display: "block",
          background: "transparent",
        }}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 2 L 6 5 L 0 8 z" fill="#76a08b" />
          </marker>
          <marker
            id="arrow-active"
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 2 L 6 5 L 0 8 z" fill="var(--primary)" />
          </marker>
        </defs>

        <style>{`
          @keyframes flow-right {
            to {
              stroke-dashoffset: -20;
            }
          }
          @keyframes flow-left {
            to {
              stroke-dashoffset: 20;
            }
          }
          .flow-line {
            stroke-dasharray: 6, 6;
            animation: flow-right 0.8s linear infinite;
          }
          .flow-line-reverse {
            stroke-dasharray: 6, 6;
            animation: flow-left 0.8s linear infinite;
          }
        `}</style>

        <FlowLine id="submit" path="M 204 93 H 278" label="POST /deploy" labelX={241} labelY={75} />
        <FlowLine id="enqueue" path="M 470 93 H 542" label="Enqueue ID" labelX={506} labelY={75} />
        <FlowLine id="receive" path="M 726 93 H 802" label="Receive job" labelX={764} labelY={75} />

        <FlowLine id="save-source" path="M 374 126 V 244" label="Save source" labelX={332} labelY={179} />
        <FlowLine id="read-status" path="M 452 126 V 206 H 570 V 244" label="Read progress" labelX={512} labelY={194} />
        <FlowLine id="update-status" path="M 842 126 V 173 H 654 V 244" label="Status + lease" labelX={745} labelY={161} />
        <FlowLine id="launch-task" path="M 904 126 V 244" label="Launch task" labelX={949} labelY={179} />

        <FlowLine id="read-preview" path="M 204 277 H 278" label="Read site" labelX={241} labelY={258} />
        <FlowLine id="build-files" path="M 895 310 V 349 H 374 V 310" label="Read / write files" labelX={632} labelY={334} />

        <Node id="frontend" x={32} y={60} width={172} height={66} title="Dashboard" subtext="Submit a Git URL" icon={Icons.Frontend} stepId="01" />
        <Node id="uploader" x={278} y={60} width={192} height={66} title="Upload API" subtext="Clone and stage source" icon={Icons.Uploader} stepId="02" />
        <Node id="sqs" x={542} y={60} width={184} height={66} title="Amazon SQS" subtext="Deployment queue" icon={Icons.Queue} stepId="03" />
        <Node id="worker" x={802} y={60} width={190} height={66} title="Deploy Worker" subtext="Launch and track tasks" icon={Icons.Worker} stepId="04" />

        <Node id="preview" x={32} y={244} width={172} height={66} title="Preview Server" subtext="Route by deploy ID" icon={Icons.Router} stepId="04" />
        <Node id="s3" x={278} y={244} width={192} height={66} title="Amazon S3" subtext="Source and built files" icon={Icons.S3} stepId="02" />
        <Node id="redis" x={542} y={244} width={184} height={66} title="Redis" subtext="Status, logs, leases" icon={Icons.Redis} stepId="03" />
        <Node id="fargate" x={802} y={244} width={190} height={66} title="ECS Fargate" subtext="One task per build" icon={Icons.Fargate} stepId="04" />
      </svg>
    </div>
  );
}

// ─── Mobile Fallback List Layout ────────────────────────────────────────────
export function MobileFlowDiagram() {
  const mobileFlow = [
    {
      step: "01",
      title: "Developer & Client UI",
      desc: "Paste repository URL inside the React Frontend, triggering POST /deploy API requests.",
      nodes: ["Developer", "React Frontend"],
    },
    {
      step: "02",
      title: "Express Upload Service",
      desc: "Clones the repo locally on Disk, strips metadata, and uploads source files to Amazon S3 Object Storage.",
      nodes: ["Upload Service", "Local Disk Storage", "Amazon S3"],
    },
    {
      step: "03",
      title: "Queue and track",
      desc: "Sends the deployment ID to SQS and records progress in Redis.",
      nodes: ["Amazon SQS", "Redis"],
    },
    {
      step: "04",
      title: "Build and preview",
      desc: "The worker receives the job from SQS and can launch Fargate. The runner writes the built site to S3.",
      nodes: ["Deploy Worker", "ECS Fargate", "Preview Server"],
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {mobileFlow.map((item, index) => (
        <div
          key={item.step}
          style={{
            borderRadius: 12,
            border: "1px solid var(--border-card)",
            background: "var(--bg-card)",
            padding: 16,
            position: "relative",
          }}
        >
          {index < mobileFlow.length - 1 && (
            <div
              style={{
                position: "absolute",
                left: 32,
                top: 48,
                bottom: -24,
                width: 1,
                backgroundImage: "repeating-linear-gradient(to bottom, var(--border-card) 0px, var(--border-card) 4px, transparent 4px, transparent 8px)",
                zIndex: 1,
              }}
            />
          )}

          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", position: "relative", zIndex: 2 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "var(--bg-card-inner)",
                border: "1px solid var(--border-card)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--primary)",
                flexShrink: 0,
              }}
            >
              {item.step}
            </div>

            <div style={{ flex: 1 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4, fontFamily: "var(--font-body)" }}>
                {item.title}
              </h4>
              <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
                {item.desc}
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {item.nodes.map((node) => (
                  <span
                    key={node}
                    style={{
                      fontSize: 9,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-secondary)",
                      background: "var(--bg-card-inner)",
                      padding: "3px 6px",
                      borderRadius: 4,
                      border: "1px solid var(--border-card)",
                    }}
                  >
                    {node}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Landing Component ─────────────────────────────────────────────────
export default function LandingHowItWorks() {
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);

  return (
    <section id="architecture" style={{ position: "relative", padding: "clamp(48px, 6vw, 96px) clamp(20px, 4vw, 48px)" }}>
      <FadeUp>
        <div style={{ marginBottom: 48, display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel text="// How it works" />
          <h2
            style={{
              fontSize: "clamp(24px, 4vw, 36px)",
              fontWeight: 500,
              letterSpacing: "-0.03em",
              lineHeight: 1.15,
              fontFamily: "var(--font-body)",
            }}
          >
            From repo to live site,{" "}
            <span style={{ color: "var(--primary)", fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 400 }}>
              four steps.
            </span>
          </h2>
        </div>
      </FadeUp>

      <PipelineSteps hoveredStep={hoveredStep} setHoveredStep={setHoveredStep} />

      {/* Architecture Detail Diagram */}
      <div style={{ marginTop: 64 }}>
        <FadeUp>
          <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--primary-dim)",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
              }}
            >
              // SYSTEM DESIGN
            </span>
            <h3
              style={{
                fontSize: "clamp(18px, 3vw, 24px)",
                fontWeight: 500,
                color: "var(--text-primary)",
                fontFamily: "var(--font-body)",
                letterSpacing: "-0.02em",
              }}
            >
              How a deploy flows
            </h3>
          </div>
        </FadeUp>

        {/* Desktop interactive SVG flow */}
        <div className="desktop-only" style={{ width: "100%", justifyContent: "center" }}>
          <FadeUp style={{ width: "100%" }}>
            <ArchitectureDiagram hoveredStep={hoveredStep} setHoveredStep={setHoveredStep} />
          </FadeUp>
        </div>

        {/* Mobile vertical layout flow */}
        <div className="mobile-only" style={{ width: "100%", flexDirection: "column" }}>
          <FadeUp style={{ width: "100%" }}>
            <MobileFlowDiagram />
          </FadeUp>
        </div>
      </div>
    </section>
  );
}

