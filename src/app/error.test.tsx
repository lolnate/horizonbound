// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorPage from "./error";

describe("ErrorPage", () => {
  it("offers a safe recovery path without exposing server details", () => {
    render(<ErrorPage error={new Error("secret provider detail")} reset={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/could not complete/i);
    expect(screen.queryByText(/secret provider detail/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
