// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("identifies Horizonbound and the disconnected state", () => {
    render(<AppShell nonLoopbackWarning={null} credentialMode={null} />);

    expect(screen.getByRole("heading", { name: "Horizonbound" })).toBeInTheDocument();
    expect(screen.getByText(/not connected to linear/i)).toBeInTheDocument();
  });

  it("shows the network exposure warning when supplied", () => {
    render(
      <AppShell
        nonLoopbackWarning="Network peers may be able to reach this application."
        credentialMode={null}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/network peers/i);
  });

  it("explains retained local data after disconnect", () => {
    render(
      <AppShell
        nonLoopbackWarning={null}
        credentialMode={null}
        notice="Linear disconnected. Cached local data remains in the configured state directory."
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/cached local data remains/i);
  });

  it("connects with the configured credential mode and explains its boundary", () => {
    const { rerender } = render(<AppShell nonLoopbackWarning={null} credentialMode={null} />);
    expect(screen.queryByRole("link", { name: "Connect Linear" })).not.toBeInTheDocument();

    rerender(<AppShell nonLoopbackWarning={null} credentialMode="api_key" />);
    expect(screen.getByRole("button", { name: "Connect Linear" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect Linear" }).closest("form")).toHaveAttribute(
      "action",
      "/api/auth/linear/start"
    );
    expect(screen.getByText(/configured personal API key/i)).toBeInTheDocument();

    rerender(<AppShell nonLoopbackWarning={null} credentialMode="oauth" />);
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
  });
});
