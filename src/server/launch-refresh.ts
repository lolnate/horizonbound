export class LaunchRefreshCoordinator {
  private readonly requested = new Set<string>();

  constructor(
    private readonly refresh: (connectionId: string, planId: string | null) => Promise<unknown>
  ) {}

  async request(connectionId: string, planId: string | null): Promise<boolean> {
    if (this.requested.has(connectionId)) return false;
    this.requested.add(connectionId);
    await this.refresh(connectionId, planId);
    return true;
  }
}
