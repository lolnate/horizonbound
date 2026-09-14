import { describe, expect, it, vi } from "vitest";
import { LaunchRefreshCoordinator } from "./launch-refresh";

describe("LaunchRefreshCoordinator", () => {
  it("runs at most one first-load refresh per connection for the process lifetime", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = vi.fn(async () => blocked);
    const coordinator = new LaunchRefreshCoordinator(refresh);

    const first = coordinator.request("connection-1", "plan-1");
    const second = coordinator.request("connection-1", "plan-1");
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([true, false]);
    expect(refresh).toHaveBeenCalledTimes(1);
    await expect(coordinator.request("connection-1", "plan-1")).resolves.toBe(false);
  });
});
