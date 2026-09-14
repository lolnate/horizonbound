// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConnectionStatus } from "./connection-status";

describe("ConnectionStatus", () => {
  it("explains that ending an API-key session does not revoke the key", () => {
    render(<ConnectionStatus credentialMode="api_key" syncFailed={false} />);

    expect(screen.getByText(/Connected with a personal API key/i)).toHaveTextContent(
      /connected with a personal API key/i
    );
    expect(screen.getByText(/Connected with a personal API key/i)).toHaveTextContent(
      /does not revoke/i
    );
  });

  it("makes a failed initial source sync explicit", () => {
    render(<ConnectionStatus credentialMode="api_key" syncFailed />);

    expect(screen.getByRole("alert")).toHaveTextContent(/source sync failed/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/read access/i);
  });
});
