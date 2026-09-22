import { useId, useState } from "react";
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
  const [selected, setSelected] = useState("notes");
  const [visited, setVisited] = useState({ notes: true });
  const tabs = [
    { key: "notes", label: "Internal Notes" },
    ...(audience === "public"
      ? [{ key: "communication", label: "Requester Communication" }]
      : []),
  ];
  const select = (key) => {
    setSelected(key);
    setVisited((current) => ({ ...current, [key]: true }));
  };
  return (
    <ContentCard className="request-collaboration">
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
          {visited[tab.key] &&
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
                onAccessFailure={onAccessFailure}
              />
            ))}
        </div>
      ))}
    </ContentCard>
  );
}
