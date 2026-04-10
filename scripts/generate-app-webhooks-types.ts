import { mkdirSync, writeFileSync } from "node:fs";

import { compile } from "json-schema-to-typescript";

const schemaFileNames = [
  // List of all Saleor webhook response schemas - uncomment those you need
  // "CheckoutCalculateTaxes",
  // "CheckoutFilterShippingMethods",
  // "ListStoredPaymentMethods",
  // "OrderCalculateTaxes",
  // "PaymentGatewayInitializeSession",
  // "PaymentGatewayInitializeTokenizationSession",
  // "ShippingListMethodsForCheckout",
  // "ShippingListMethodsForOrder",
  // "StoredPaymentMethodDeleteRequested",
  // "TransactionCancelationRequested",
  // "TransactionChargeRequested",
  "TransactionInitializeSession",
  "TransactionProcessSession",
  // "TransactionRefundRequested",
];

const path = "https://raw.githubusercontent.com/saleor/saleor/main/saleor/json_schemas/";
const outputDirectory = "./generated/app-webhooks-types";

const convertToKebabCase = (fileName: string): string => {
  return fileName
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");
};

const schemaMapping = schemaFileNames.map((fileName) => ({
  fileName: convertToKebabCase(fileName),
  url: `${path}${fileName}.json`,
}));

async function main() {
  mkdirSync(outputDirectory, { recursive: true });

  await Promise.all(
    schemaMapping.map(async ({ fileName, url }) => {
      const res = await fetch(url);

      const fetchedSchema = await res.json();

      const compiledTypes = await compile(fetchedSchema, fileName, {
        additionalProperties: false,
      });

      writeFileSync(`${outputDirectory}/${fileName}.ts`, compiledTypes);
    }),
  );
}

try {
  console.log("Fetching JSON schemas from Saleor GitHub repository...");
  await main();
  console.log("Successfully generated TypeScript files from JSON schemas.");
} catch (error) {
  console.error(`Error generating webhook response types: ${error}`);
  process.exit(1);
}
