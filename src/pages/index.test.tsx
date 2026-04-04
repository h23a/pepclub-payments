import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import IndexPage from "@/pages/index";

const useAppBridge = vi.fn();

vi.mock("@saleor/app-sdk/app-bridge", () => ({
  useAppBridge: () => useAppBridge(),
}));

vi.mock("@/components/dashboard/dashboard-page", () => ({
  DashboardPage: () => <div>dashboard-page</div>,
}));

vi.mock("@/components/public/home-page", () => ({
  PublicHomePage: () => <div>public-home-page</div>,
}));

describe("index page", () => {
  it("renders the public home page when the Saleor app bridge is not ready", () => {
    useAppBridge.mockReturnValue({
      appBridgeState: {
        ready: false,
        saleorApiUrl: null,
        token: null,
      },
    });

    render(<IndexPage />);

    expect(screen.getByText("public-home-page")).toBeInTheDocument();
  });

  it("renders the dashboard page when the embedded Saleor context is ready", () => {
    useAppBridge.mockReturnValue({
      appBridgeState: {
        ready: true,
        saleorApiUrl: "https://saleor.example/graphql/",
        token: "token",
      },
    });

    render(<IndexPage />);

    expect(screen.getByText("dashboard-page")).toBeInTheDocument();
  });
});
