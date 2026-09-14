"use client";

import { useState } from "react";

interface SourceChoice {
  id: string;
  name: string;
}

interface StatusChoice extends SourceChoice {
  teamId: string | null;
}

interface PlanSetupProps {
  workspaceName: string;
  userName: string;
  teams: SourceChoice[];
  labels: SourceChoice[];
  statuses: StatusChoice[];
  saveAction: (formData: FormData) => void | Promise<void>;
}

export function PlanSetup({
  workspaceName,
  userName,
  teams,
  labels,
  statuses,
  saveAction
}: PlanSetupProps) {
  const [lanes, setLanes] = useState([crypto.randomUUID()]);

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">
            {userName} · {workspaceName}
          </p>
          <h1>Configure your roadmap</h1>
        </div>
      </header>
      <form action={saveAction} className="setup-form">
        <label>
          Plan name
          <input name="name" required />
        </label>
        <label>
          Team
          <select name="teamId" required>
            {teams.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Membership label
          <select name="membershipLabelId" required>
            {labels.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Commitment status
          <select name="commitmentStatusId" required>
            {statuses.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rolling horizon (weeks)
          <input name="horizonWeeks" type="number" min="1" step="1" defaultValue="20" required />
        </label>
        <label>
          Weekly capacity (points)
          <input name="weeklyCapacity" type="number" min="0" step="1" required />
        </label>
        <label>
          Capacity effective date
          <input name="capacityEffectiveDate" type="date" required />
        </label>
        <label>
          Refinement lead time (days)
          <input
            name="refinementLeadTimeDays"
            type="number"
            min="0"
            step="1"
            defaultValue="14"
            required
          />
        </label>

        <fieldset className="lane-editor">
          <legend>Capacity lanes</legend>
          {lanes.map((id, index) => (
            <div className="lane-row" key={id}>
              <label>
                Lane name
                <input name="laneName" defaultValue={index === 0 ? "Product" : ""} required />
              </label>
              <label>
                Weekly allocation
                <input name="laneAllocation" type="number" min="0" step="1" required />
              </label>
              {lanes.length > 1 ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setLanes((current) => current.filter((lane) => lane !== id))}
                >
                  Remove lane
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            onClick={() => setLanes((current) => [...current, crypto.randomUUID()])}
          >
            Add capacity lane
          </button>
        </fieldset>
        <button type="submit">Save plan and synchronize</button>
      </form>
    </main>
  );
}
