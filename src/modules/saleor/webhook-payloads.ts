export const transactionInitializeSessionSubscription = /* GraphQL */ `
  subscription TransactionInitializeSessionSubscription {
    event {
      ... on TransactionInitializeSession {
        issuedAt
        version
        merchantReference
        customerIpAddress
        idempotencyKey
        data
        action {
          amount
          currency
          actionType
        }
        transaction {
          id
          token
          pspReference
          externalUrl
        }
        sourceObject {
          __typename
          ... on Checkout {
            id
            email
            channel {
              slug
            }
            shippingAddress {
              country {
                code
                country
              }
            }
            billingAddress {
              country {
                code
                country
              }
            }
            metadata {
              key
              value
            }
            privateMetadata {
              key
              value
            }
          }
          ... on Order {
            id
            checkoutId
            userEmail
            channel {
              slug
            }
            shippingAddress {
              country {
                code
                country
              }
            }
            billingAddress {
              country {
                code
                country
              }
            }
            metadata {
              key
              value
            }
            privateMetadata {
              key
              value
            }
          }
        }
      }
    }
  }
`;

export const transactionProcessSessionSubscription = /* GraphQL */ `
  subscription TransactionProcessSessionSubscription {
    event {
      ... on TransactionProcessSession {
        issuedAt
        version
        merchantReference
        customerIpAddress
        data
        action {
          amount
          currency
          actionType
        }
        transaction {
          id
          token
          pspReference
          externalUrl
        }
        sourceObject {
          __typename
          ... on Checkout {
            id
            email
            channel {
              slug
            }
            shippingAddress {
              country {
                code
                country
              }
            }
            billingAddress {
              country {
                code
                country
              }
            }
            metadata {
              key
              value
            }
            privateMetadata {
              key
              value
            }
          }
          ... on Order {
            id
            checkoutId
            userEmail
            channel {
              slug
            }
            shippingAddress {
              country {
                code
                country
              }
            }
            billingAddress {
              country {
                code
                country
              }
            }
            metadata {
              key
              value
            }
            privateMetadata {
              key
              value
            }
          }
        }
      }
    }
  }
`;
