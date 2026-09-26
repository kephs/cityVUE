import { useId, useState, useRef, useLayoutEffect } from "react";
import {
  ContentCard,
  SectionHeading,
} from "../../components/ui/RequestPresentation.jsx";
import InternalNotes from "./InternalNotes.jsx";
import RequestCommunication from "./RequestCommunication.jsx";

export default function CollaborationPanel({
  repository,
  id,
  audience,
  capabilities,
  onAccessFailure,
}) {
  const baseId = useId();
  const root = useRef(null);
  const focusInside = useRef(false);
  const [chosen, setSelected] = useState(null);
  const [visited, setVisited] = useState({});
  const notes = { key: "notes", label: "Internal Notes" };
  const communication = {
    key: "communication",
    label: "Requester Communication",
  };
  const tabs = (
    audience === "public" ? [communication, notes] : [notes, communication]
  ).filter((tab) =>
    tab.key === "notes"
      ? capabilities.canReadNotes
      : capabilities.canReadCommunications,
  );
  const selected = tabs.some((tab) => tab.key === chosen)
    ? chosen
    : tabs[0]?.key;
  const previousSelection = useRef(selected);
  useLayoutEffect(() => {
    if (previousSelection.current !== selected && focusInside.current) {
      const target = selected
        ? document.getElementById(`${baseId}-${selected}-tab`)
        : document.querySelector(
            ".request-issue-title, #staff-requests-heading",
          );
      target?.focus();
      focusInside.current = Boolean(selected);
    }
    previousSelection.current = selected;
  }, [selected, baseId]);
  useLayoutEffect(() => {
    if (selected)
      setVisited((current) =>
        current[selected] ? current : { ...current, [selected]: true },
      );
  }, [selected]);
  const select = (key) => {
    setSelected(key);
    setVisited((current) => ({ ...current, [key]: true }));
  };
  if (!tabs.length) return null;
  return (
    <ContentCard className="request-collaboration">
      <div
        ref={root}
        onFocusCapture={() => {
          focusInside.current = true;
        }}
        onBlurCapture={(event) => {
          if (
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            focusInside.current = false;
        }}
      >
        <SectionHeading icon="chat-square-text">Collaboration</SectionHeading>
        <div
          role="tablist"
          aria-label="Collaboration"
          className="collaboration-tabs"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`${baseId}-${tab.key}-tab`}
              aria-controls={`${baseId}-${tab.key}-panel`}
              aria-selected={selected === tab.key}
              tabIndex={selected === tab.key ? 0 : -1}
              onClick={() => select(tab.key)}
              onKeyDown={(event) => {
                const next = {
                  ArrowRight: (index + 1) % tabs.length,
                  ArrowLeft: (index + tabs.length - 1) % tabs.length,
                  Home: 0,
                  End: tabs.length - 1,
                }[event.key];
                if (next === undefined) return;
                event.preventDefault();
                select(tabs[next].key);
                document
                  .getElementById(`${baseId}-${tabs[next].key}-tab`)
                  ?.focus();
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {tabs.map((tab) => (
          <div
            key={tab.key}
            role="tabpanel"
            id={`${baseId}-${tab.key}-panel`}
            aria-labelledby={`${baseId}-${tab.key}-tab`}
            hidden={selected !== tab.key}
            tabIndex={0}
          >
            {(visited[tab.key] || selected === tab.key) &&
              (tab.key === "notes" ? (
                <InternalNotes
                  embedded
                  active={selected === tab.key}
                  repository={repository}
                  id={id}
                  canRead={capabilities.canReadNotes}
                  canCreate={capabilities.canCreateNotes}
                  onAccessFailure={onAccessFailure}
                />
              ) : (
                <RequestCommunication
                  embedded
                  active={selected === tab.key}
                  repository={repository}
                  id={id}
                  canRead={capabilities.canReadCommunications}
                  canCreate={capabilities.canCreateCommunication}
                  unavailableReason={
                    capabilities.communicationCreationUnavailableReason
                  }
                  onAccessFailure={onAccessFailure}
                />
              ))}
          </div>
        ))}
      </div>
    </ContentCard>
  );
}
