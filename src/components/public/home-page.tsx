import { Box, Button, Input, Text } from "@saleor/macaw-ui";

export const PublicHomePage = () => {
  return (
    <Box className="dashboardPage publicPage narrowPage">
      <Box className="pageHeader">
        <Box className="titleBlock">
          <Text size={11} className="pageTitle">
            Pepclub Payments
          </Text>
          <Text as="p" color="default2" className="mutedText">
            Saleor payment app for MoonPay, Ramp Network, and NOWPayments with hosted, offsite
            payment flows.
          </Text>
        </Box>
      </Box>

      <Box className="appCard">
        <Box className="titleBlock tight">
          <Text size={2} as="span" className="heroEyebrow">
            Saleor App
          </Text>
          <Text size={7} as="h2" className="headingText">
            Install Pepclub Payments
          </Text>
          <Text as="p" color="default2" className="mutedText">
            Add the app to Saleor, then manage provider readiness, diagnostics, and transaction
            operations from the embedded dashboard.
          </Text>
        </Box>

        <Box className="fieldGrid">
          <Box className="miniCard">
            <Text className="labelText">What this app exposes</Text>
            <Text as="p" color="default2" className="mutedText">
              Hosted payment provider integrations for MoonPay, Ramp Network, and NOWPayments, plus
              webhook processing, transaction visibility, settings, and operational diagnostics in
              one dashboard.
            </Text>
          </Box>
          <Box className="miniCard">
            <Text className="labelText">Quick links</Text>
            <Box className="actionsRow wrap">
              <Button as="a" href="/api/health" variant="secondary">
                Check health endpoint
              </Button>
              <Button as="a" href="/api/manifest" variant="secondary">
                Open manifest
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box
        as="form"
        className="appCard formCard"
        onSubmit={(event) => {
          event.preventDefault();

          const saleorUrl = new FormData(event.currentTarget as HTMLFormElement).get("saleor-url");
          const manifestUrl = new URL("/api/manifest", window.location.origin);
          const redirectUrl = new URL(
            `/dashboard/apps/install?manifestUrl=${encodeURIComponent(manifestUrl.toString())}`,
            saleorUrl as string
          ).toString();

          window.open(redirectUrl, "_blank", "noopener,noreferrer");
        }}
      >
        <Box className="titleBlock tight">
          <Text size={7} as="h2" className="headingText">
            Open install flow
          </Text>
          <Text as="p" color="default2" className="mutedText">
            Point this app to the Saleor Dashboard URL where you want Pepclub Payments installed.
          </Text>
        </Box>
        <Input type="url" required label="Saleor Dashboard URL" name="saleor-url" />
        <Box className="actionsRow end">
          <Button type="submit">Install in Saleor</Button>
        </Box>
      </Box>
    </Box>
  );
};
