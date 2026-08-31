// ---------------------------------------------------------------------------
// Subscriptions — hand-written react-query hooks for the subscriptions API.
// Mirrors the generated Orval hook shape (query keys, options, mutation) so
// the apps can use them exactly like the generated hooks. Lives outside the
// generated folder so it survives regenerate.
// ---------------------------------------------------------------------------

import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  MutationFunction,
  QueryFunction,
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";

import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

export type SubscriptionRecord = {
  id: string;
  kind: "pass" | "storage" | "projects";
  planId: string;
  planLabel: string;
  priceUsd: number;
  status: string;
  intervalLabel: string;
  periodStart: string;
  periodEnd: string;
  source: string;
  promoCode: string | null;
  cardLast4: string | null;
  active: boolean;
};

export type SubscriptionPlan = {
  kind: "pass" | "storage" | "projects";
  planId: string;
  planLabel: string;
  priceUsd: number;
  intervalLabel: string;
  detail: string;
};

export type SubscriptionPlansResponse = {
  plans: SubscriptionPlan[];
  current: SubscriptionRecord[];
  usage: {
    storage: { usedBytes: number; totalBytes: number; remainingBytes: number };
    projects: { used: number; total: number; remaining: number };
  };
};

export type SubscriptionCard = {
  number: string;
  expiryMonth: number;
  expiryYear: number;
  cvc: string;
};

export type SubscriptionPurchaseInput = {
  kind: "pass" | "storage" | "projects";
  planId: string;
  card: SubscriptionCard;
  promoCode?: string;
};

export type SubscriptionReceipt = {
  subtotal: number;
  discount: number;
  total: number;
  cardLast4: string;
  promoCode: string | null;
};

export type SubscriptionPurchaseResponse = {
  subscription: SubscriptionRecord;
  receipt: SubscriptionReceipt;
};

// ---- list subscriptions ----

export const getListSubscriptionsUrl = () => `/api/subscriptions`;

export const listSubscriptions = async (options?: Parameters<typeof customFetch>[1]): Promise<SubscriptionRecord[]> =>
  customFetch<SubscriptionRecord[]>(getListSubscriptionsUrl(), { ...options, method: "GET" });

export const getListSubscriptionsQueryKey = () => [`/api/subscriptions`] as const;

export const getListSubscriptionsQueryOptions = <
  TData = Awaited<ReturnType<typeof listSubscriptions>>,
  TError = ErrorType<unknown>,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSubscriptions>>, TError, TData>;
    request?: Parameters<typeof customFetch>[1];
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListSubscriptionsQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof listSubscriptions>>> = ({ signal }) =>
    listSubscriptions({ signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof listSubscriptions>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export function useListSubscriptions<
  TData = Awaited<ReturnType<typeof listSubscriptions>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof listSubscriptions>>, TError, TData>;
  request?: Parameters<typeof customFetch>[1];
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getListSubscriptionsQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

// ---- plans (catalog + current entitlements) ----

export const getSubscriptionPlansUrl = () => `/api/subscriptions/plans`;

export const subscriptionPlans = async (options?: Parameters<typeof customFetch>[1]): Promise<SubscriptionPlansResponse> =>
  customFetch<SubscriptionPlansResponse>(getSubscriptionPlansUrl(), { ...options, method: "GET" });

export const getSubscriptionPlansQueryKey = () => [`/api/subscriptions/plans`] as const;

export const getSubscriptionPlansQueryOptions = <
  TData = Awaited<ReturnType<typeof subscriptionPlans>>,
  TError = ErrorType<unknown>,
>(
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof subscriptionPlans>>, TError, TData>;
    request?: Parameters<typeof customFetch>[1];
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getSubscriptionPlansQueryKey();
  const queryFn: QueryFunction<Awaited<ReturnType<typeof subscriptionPlans>>> = ({ signal }) =>
    subscriptionPlans({ signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof subscriptionPlans>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export function useSubscriptionPlans<
  TData = Awaited<ReturnType<typeof subscriptionPlans>>,
  TError = ErrorType<unknown>,
>(options?: {
  query?: UseQueryOptions<Awaited<ReturnType<typeof subscriptionPlans>>, TError, TData>;
  request?: Parameters<typeof customFetch>[1];
}): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getSubscriptionPlansQueryOptions(options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

// ---- purchase ----

export const purchaseSubscription = async (
  body: SubscriptionPurchaseInput,
  options?: Parameters<typeof customFetch>[1],
): Promise<SubscriptionPurchaseResponse> =>
  customFetch<SubscriptionPurchaseResponse>(getListSubscriptionsUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const getPurchaseSubscriptionMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof purchaseSubscription>>,
    TError,
    { data: SubscriptionPurchaseInput },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationOptions<
  Awaited<ReturnType<typeof purchaseSubscription>>,
  TError,
  { data: SubscriptionPurchaseInput },
  TContext
> => {
  const mutationKey = ["purchaseSubscription"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof purchaseSubscription>>,
    { data: SubscriptionPurchaseInput }
  > = ({ data }) => purchaseSubscription(data, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export const usePurchaseSubscriptionId = "purchaseSubscription";

export function usePurchaseSubscription<
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof purchaseSubscription>>,
    TError,
    { data: SubscriptionPurchaseInput },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationResult<
  Awaited<ReturnType<typeof purchaseSubscription>>,
  TError,
  { data: SubscriptionPurchaseInput },
  TContext
> {
  return useMutation(getPurchaseSubscriptionMutationOptions(options));
}

function withQueryKey<T extends object, K>(query: T, queryKey: K): T & { queryKey: K } {
  const result = { queryKey } as T & { queryKey: K };
  for (const key of Object.keys(query)) {
    if (key === "queryKey") continue;
    Object.defineProperty(result, key, { enumerable: true, configurable: true, get: () => (query as Record<string, unknown>)[key] });
  }
  return result;
}

export default { useListSubscriptions, useSubscriptionPlans, usePurchaseSubscription };