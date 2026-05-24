import { readFileSync } from "fs";
import path from "path";
import {
  AppStoreServerAPIClient,
  Environment,
  NotificationTypeV2,
  SignedDataVerifier,
  Status,
  Subtype,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type LastTransactionsItem,
  type ResponseBodyV2DecodedPayload,
  type UpdateAppAccountTokenRequest,
} from "@apple/app-store-server-library";

type AppleServerContext = {
  environment: Environment;
  client: AppStoreServerAPIClient;
  verifier: SignedDataVerifier;
};

export type RelayAppStoreSubscriptionRecord = {
  environment: string;
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  status: string;
  currentPeriodEnd: string | null;
};

type DecodedAppleNotification = {
  payload: ResponseBodyV2DecodedPayload;
  transaction: JWSTransactionDecodedPayload | null;
  renewalInfo: JWSRenewalInfoDecodedPayload | null;
  record: RelayAppStoreSubscriptionRecord | null;
};

type ResolvedAppleSubscription = {
  context: AppleServerContext;
  transaction: JWSTransactionDecodedPayload;
  renewalInfo: JWSRenewalInfoDecodedPayload | null;
  record: RelayAppStoreSubscriptionRecord;
};

type AppStoreConfig = {
  issuerId: string;
  keyId: string;
  signingKey: string;
  bundleId: string;
  appAppleId?: number;
  onlineChecksEnabled: boolean;
  rootCertificates: Buffer[];
};

const rootCertificatePaths = [
  path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "certs/apple/AppleIncRootCertificate.cer"
  ),
  path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "certs/apple/AppleRootCA-G2.cer"
  ),
  path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "certs/apple/AppleRootCA-G3.cer"
  ),
];

let cachedConfig: AppStoreConfig | null = null;
const cachedContexts = new Map<Environment, AppleServerContext>();

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for App Store integration`);
  }
  return value;
}

function loadConfig(): AppStoreConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const signingKey = requiredEnv("APPLE_APP_STORE_PRIVATE_KEY").replace(
    /\\n/g,
    "\n"
  );

  const appAppleIdRaw = process.env.APPLE_APP_STORE_APPLE_ID?.trim();
  const appAppleId = appAppleIdRaw ? Number(appAppleIdRaw) : undefined;

  cachedConfig = {
    issuerId: requiredEnv("APPLE_APP_STORE_ISSUER_ID"),
    keyId: requiredEnv("APPLE_APP_STORE_KEY_ID"),
    signingKey,
    bundleId: requiredEnv("APPLE_APP_STORE_BUNDLE_ID"),
    appAppleId:
      appAppleId !== undefined && Number.isFinite(appAppleId)
        ? appAppleId
        : undefined,
    onlineChecksEnabled:
      process.env.APPLE_APP_STORE_ENABLE_ONLINE_CHECKS?.trim() !== "false",
    rootCertificates: rootCertificatePaths.map((filePath) =>
      readFileSync(filePath)
    ),
  };

  return cachedConfig;
}

function contextFor(environment: Environment): AppleServerContext {
  const cached = cachedContexts.get(environment);
  if (cached) {
    return cached;
  }

  const config = loadConfig();
  const context = {
    environment,
    client: new AppStoreServerAPIClient(
      config.signingKey,
      config.keyId,
      config.issuerId,
      config.bundleId,
      environment
    ),
    verifier: new SignedDataVerifier(
      config.rootCertificates,
      config.onlineChecksEnabled,
      environment,
      config.bundleId,
      environment === Environment.PRODUCTION ? config.appAppleId : undefined
    ),
  };

  cachedContexts.set(environment, context);
  return context;
}

function contextsInPriorityOrder(): AppleServerContext[] {
  return [contextFor(Environment.PRODUCTION), contextFor(Environment.SANDBOX)];
}

function millisToISOString(value?: number | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString();
}

function normalizeSubscriptionStatus(
  status: Status | number | undefined,
  notificationType?: NotificationTypeV2 | string,
  subtype?: Subtype | string,
  transaction?: JWSTransactionDecodedPayload | null,
  renewalInfo?: JWSRenewalInfoDecodedPayload | null
) {
  if (transaction?.revocationDate) {
    return "revoked";
  }

  if (
    notificationType === NotificationTypeV2.REVOKE ||
    notificationType === NotificationTypeV2.REFUND
  ) {
    return "revoked";
  }

  if (status === Status.REVOKED) {
    return "revoked";
  }

  if (
    status === Status.BILLING_GRACE_PERIOD ||
    subtype === Subtype.GRACE_PERIOD
  ) {
    return "billing_grace_period";
  }

  if (
    status === Status.BILLING_RETRY ||
    renewalInfo?.isInBillingRetryPeriod
  ) {
    return "billing_retry";
  }

  if (status === Status.EXPIRED || notificationType === NotificationTypeV2.EXPIRED) {
    return "expired";
  }

  const currentPeriodEnd = currentPeriodEndForSubscription(
    status,
    transaction,
    renewalInfo
  );

  if (
    renewalInfo?.autoRenewStatus === 0 &&
    currentPeriodEnd &&
    new Date(currentPeriodEnd) > new Date()
  ) {
    return "cancelled";
  }

  return "active";
}

function currentPeriodEndForSubscription(
  status: Status | number | undefined,
  transaction?: JWSTransactionDecodedPayload | null,
  renewalInfo?: JWSRenewalInfoDecodedPayload | null
) {
  if (
    status === Status.BILLING_GRACE_PERIOD &&
    renewalInfo?.gracePeriodExpiresDate
  ) {
    return millisToISOString(renewalInfo.gracePeriodExpiresDate);
  }

  return (
    millisToISOString(transaction?.expiresDate) ??
    millisToISOString(renewalInfo?.renewalDate) ??
    millisToISOString(renewalInfo?.gracePeriodExpiresDate)
  );
}

function buildSubscriptionRecord(
  environment: string,
  transaction: JWSTransactionDecodedPayload,
  renewalInfo: JWSRenewalInfoDecodedPayload | null,
  status: Status | number | undefined,
  notificationType?: NotificationTypeV2 | string,
  subtype?: Subtype | string
): RelayAppStoreSubscriptionRecord | null {
  const originalTransactionId = transaction.originalTransactionId?.trim();
  const transactionId = transaction.transactionId?.trim();
  const productId = transaction.productId?.trim();

  if (!originalTransactionId || !transactionId || !productId) {
    return null;
  }

  const normalizedStatus = normalizeSubscriptionStatus(
    status,
    notificationType,
    subtype,
    transaction,
    renewalInfo
  );

  return {
    environment,
    originalTransactionId,
    transactionId,
    productId,
    status: normalizedStatus,
    currentPeriodEnd: currentPeriodEndForSubscription(
      status,
      transaction,
      renewalInfo
    ),
  };
}

export async function resolveAppStoreSubscription(
  lookupTransactionId: string,
  expectedProductId?: string | null
): Promise<ResolvedAppleSubscription> {
  const attempts: string[] = [];

  for (const context of contextsInPriorityOrder()) {
    try {
      const transactionResponse = await context.client.getTransactionInfo(
        lookupTransactionId
      );
      const signedTransaction = transactionResponse.signedTransactionInfo;
      if (!signedTransaction) {
        throw new Error("App Store transaction response missing signed data");
      }

      const transaction = await context.verifier.verifyAndDecodeTransaction(
        signedTransaction
      );

      const statusResponse = await context.client.getAllSubscriptionStatuses(
        transaction.originalTransactionId ?? lookupTransactionId
      );

      const flattenedItems =
        statusResponse.data?.flatMap((group) => group.lastTransactions ?? []) ?? [];

      const matchingItem =
        selectMatchingLastTransactionItem(
          flattenedItems,
          transaction.originalTransactionId,
          expectedProductId
        ) ?? flattenedItems[0];

      let renewalInfo: JWSRenewalInfoDecodedPayload | null = null;
      let latestTransaction = transaction;

      if (matchingItem?.signedTransactionInfo) {
        latestTransaction = await context.verifier.verifyAndDecodeTransaction(
          matchingItem.signedTransactionInfo
        );
      }

      if (matchingItem?.signedRenewalInfo) {
        renewalInfo = await context.verifier.verifyAndDecodeRenewalInfo(
          matchingItem.signedRenewalInfo
        );
      }

      const record = buildSubscriptionRecord(
        context.environment,
        latestTransaction,
        renewalInfo,
        matchingItem?.status,
        undefined,
        undefined
      );

      if (!record) {
        throw new Error("Unable to build App Store subscription record");
      }

      return {
        context,
        transaction: latestTransaction,
        renewalInfo,
        record,
      };
    } catch (error) {
      attempts.push(
        `${context.environment}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  throw new Error(
    `Unable to verify App Store subscription. ${attempts.join(" | ")}`
  );
}

function selectMatchingLastTransactionItem(
  items: LastTransactionsItem[],
  originalTransactionId?: string,
  productId?: string | null
) {
  return items.find((item) => {
    if (
      originalTransactionId &&
      item.originalTransactionId &&
      item.originalTransactionId !== originalTransactionId
    ) {
      return false;
    }

    if (!productId) {
      return true;
    }

    return item.signedTransactionInfo?.includes(productId) ?? true;
  });
}

export async function setAppAccountTokenForSubscription(
  originalTransactionId: string,
  relayUserId: string,
  environment: string
) {
  const context =
    environment === Environment.SANDBOX
      ? contextFor(Environment.SANDBOX)
      : contextFor(Environment.PRODUCTION);

  const request: UpdateAppAccountTokenRequest = {
    appAccountToken: relayUserId,
  };

  await context.client.setAppAccountToken(originalTransactionId, request);
}

export async function verifyAppleNotification(
  signedPayload: string
): Promise<DecodedAppleNotification> {
  const attempts: string[] = [];

  for (const context of contextsInPriorityOrder()) {
    try {
      const payload = await context.verifier.verifyAndDecodeNotification(
        signedPayload
      );

      const signedTransactionInfo = payload.data?.signedTransactionInfo;
      const signedRenewalInfo = payload.data?.signedRenewalInfo;

      const transaction = signedTransactionInfo
        ? await context.verifier.verifyAndDecodeTransaction(signedTransactionInfo)
        : null;
      const renewalInfo = signedRenewalInfo
        ? await context.verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo)
        : null;

      return {
        payload,
        transaction,
        renewalInfo,
        record: transaction
          ? buildSubscriptionRecord(
              context.environment,
              transaction,
              renewalInfo,
              payload.data?.status,
              payload.notificationType,
              payload.subtype
            )
          : null,
      };
    } catch (error) {
      attempts.push(
        `${context.environment}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  throw new Error(
    `Unable to verify App Store notification. ${attempts.join(" | ")}`
  );
}
