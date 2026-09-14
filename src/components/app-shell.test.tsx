// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("identifies Horizonbound and the disconnected state", () => {
    render(<AppShell nonLoopbackWarning={null} oauthConfigured={false} />);

    expect(screen.getByRole("heading", { name: "Horizonbound" })).toBeInTheDocument();
    expect(screen.getByText(/not connected to linear/i)).toBeInTheDocument();
  });

  it("shows the network exposure warning when supplied", () => {
    render(
      <AppShell
        nonLoopbackWarning="Network peers may be able to reach this application."
        oauthConfigured={false}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/network peers/i);
  });

  it("explains retained local data after disconnect", () => {
    render(
      <AppShell
        nonLoopbackWarning={null}
        oauthConfigured={false}
        notice="Linear disconnected. Cached local data remains in the configured state directory."
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(/cached local data remains/i);
  });

  it("links to Linear connection only when OAuth is configured", () => {
    const { rerender } = render(<AppShell nonLoopbackWarning={null} oauthConfigured={false} />);
    expect(screen.queryByRole("link", { name: "Connect Linear" })).not.toBeInTheDocument();

    rerender(<AppShell nonLoopbackWarning={null} oauthConfigured />);
    expect(screen.getByRole("link", { name: "Connect Linear" })).toHaveAttribute(
      "href",
      "/api/auth/linear/start"
    );
  });
});
