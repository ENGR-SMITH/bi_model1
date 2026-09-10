// ---------------------------------------------------------------------------
// Whop — hand-written react-query hooks for the hosted-checkout flow.
// Mirrors the generated Orval hook shape so the apps can use these exactly
// like the generated hooks. No card details are ever collected client-side:
// checkout returns a Whop purchase URL the app redirects to, and confirm is
// called from the return page once the customer is back.
// ---------------------------------------------------------------------------

import { useMutation } from "@tanstack/react-query";
import type {
  MutationFunction,
  UseMutationOptions,
  UseMutationResult,
} from "@tanstack/react-query";

import { customFetch } from "./custom-fetch";
import type { ErrorType } from "./custom-fetch";

export type SubscriptionKind = "pass" | "storage" | "projects";

export type WhopCheckoutInput = {
  kind: SubscriptionKind;
  planId: string;
  promoCode?: string;
  /** Where Whop should send the customer after paying (their own page). */
  callbackUrl?: string;
  /** Deprecated and ignored — every Whop subscription auto-renews by
      default and only an administrator can turn it off. */
  autoRenew?: boolean;
};

export type WhopCheckoutResponse =
  | { granted: true; checkoutUrl: null; reference: null }
  | { granted: false; checkoutUrl: string; reference: string };

export type WhopReceipt = {
  total: number;
  cardLast4: string | null;
  promoCode: string | null;
};

export type WhopConfirmResponse = {
  granted: boolean;
  status?: string;
  error?: string;
  receipt?: WhopReceipt;
};

// ---- create checkout ----

export const getWhopCheckoutUrl = () => `/api/whop/checkout`;

export const createWhopCheckout = async (
  body: WhopCheckoutInput,
  options?: Parameters<typeof customFetch>[1],
): Promise<WhopCheckoutResponse> =>
  customFetch<WhopCheckoutResponse>(getWhopCheckoutUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const getCreateWhopCheckoutMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createWhopCheckout>>,
    TError,
    { data: WhopCheckoutInput },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationOptions<
  Awaited<ReturnType<typeof createWhopCheckout>>,
  TError,
  { data: WhopCheckoutInput },
  TContext
> => {
  const mutationKey = ["createWhopCheckout"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createWhopCheckout>>,
    { data: WhopCheckoutInput }
  > = ({ data }) => createWhopCheckout(data, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export const useCreateWhopCheckoutId = "createWhopCheckout";

export function useCreateWhopCheckout<
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createWhopCheckout>>,
    TError,
    { data: WhopCheckoutInput },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationResult<
  Awaited<ReturnType<typeof createWhopCheckout>>,
  TError,
  { data: WhopCheckoutInput },
  TContext
> {
  return useMutation(getCreateWhopCheckoutMutationOptions(options));
}

// ---- confirm (called from the return page after redirect) ----

export const getWhopConfirmUrl = () => `/api/whop/confirm`;

export const confirmWhopCheckout = async (
  body: { reference: string },
  options?: Parameters<typeof customFetch>[1],
): Promise<WhopConfirmResponse> =>
  customFetch<WhopConfirmResponse>(getWhopConfirmUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const getConfirmWhopCheckoutMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof confirmWhopCheckout>>,
    TError,
    { data: { reference: string } },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationOptions<
  Awaited<ReturnType<typeof confirmWhopCheckout>>,
  TError,
  { data: { reference: string } },
  TContext
> => {
  const mutationKey = ["confirmWhopCheckout"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof confirmWhopCheckout>>,
    { data: { reference: string } }
  > = ({ data }) => confirmWhopCheckout(data, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export const useConfirmWhopCheckoutId = "confirmWhopCheckout";

export function useConfirmWhopCheckout<
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof confirmWhopCheckout>>,
    TError,
    { data: { reference: string } },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationResult<
  Awaited<ReturnType<typeof confirmWhopCheckout>>,
  TError,
  { data: { reference: string } },
  TContext
> {
  return useMutation(getConfirmWhopCheckoutMutationOptions(options));
}

export default { useCreateWhopCheckout, useConfirmWhopCheckout };