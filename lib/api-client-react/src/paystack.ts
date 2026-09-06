// ---------------------------------------------------------------------------
// Paystack — hand-written react-query hooks for the hosted-checkout flow.
// Mirrors the generated Orval hook shape so the apps can use these exactly
// like the generated hooks. No card details are ever collected client-side:
// checkout returns a Paystack authorization URL the app redirects to, and
// confirm is called from the return page once the customer is back.
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

export type PaystackCheckoutInput = {
  kind: SubscriptionKind;
  planId: string;
  promoCode?: string;
  /** Where Paystack should send the customer after paying (their own page). */
  callbackUrl?: string;
};

export type PaystackCheckoutResponse =
  | { granted: true; checkoutUrl: null; reference: null }
  | { granted: false; checkoutUrl: string; reference: string };

export type PaystackReceipt = {
  total: number;
  cardLast4: string | null;
  promoCode: string | null;
};

export type PaystackConfirmResponse = {
  granted: boolean;
  status?: string;
  error?: string;
  receipt?: PaystackReceipt;
};

// ---- create checkout ----

export const getPaystackCheckoutUrl = () => `/api/paystack/checkout`;

export const createPaystackCheckout = async (
  body: PaystackCheckoutInput,
  options?: Parameters<typeof customFetch>[1],
): Promise<PaystackCheckoutResponse> =>
  customFetch<PaystackCheckoutResponse>(getPaystackCheckoutUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const getCreatePaystackCheckoutMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createPaystackCheckout>>,
    TError,
    { data: PaystackCheckoutInput },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationOptions<
  Awaited<ReturnType<typeof createPaystackCheckout>>,
  TError,
  { data: PaystackCheckoutInput },
  TContext
> => {
  const mutationKey = ["createPaystackCheckout"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof createPaystackCheckout>>,
    { data: PaystackCheckoutInput }
  > = ({ data }) => createPaystackCheckout(data, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export const useCreatePaystackCheckoutId = "createPaystackCheckout";

export function useCreatePaystackCheckout<
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof createPaystackCheckout>>,
    TError,
    { data: PaystackCheckoutInput },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationResult<
  Awaited<ReturnType<typeof createPaystackCheckout>>,
  TError,
  { data: PaystackCheckoutInput },
  TContext
> {
  return useMutation(getCreatePaystackCheckoutMutationOptions(options));
}

// ---- confirm (called from the return page after redirect) ----

export const getPaystackConfirmUrl = () => `/api/paystack/confirm`;

export const confirmPaystackCheckout = async (
  body: { reference: string },
  options?: Parameters<typeof customFetch>[1],
): Promise<PaystackConfirmResponse> =>
  customFetch<PaystackConfirmResponse>(getPaystackConfirmUrl(), {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify(body),
  });

export const getConfirmPaystackCheckoutMutationOptions = <
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof confirmPaystackCheckout>>,
    TError,
    { data: { reference: string } },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationOptions<
  Awaited<ReturnType<typeof confirmPaystackCheckout>>,
  TError,
  { data: { reference: string } },
  TContext
> => {
  const mutationKey = ["confirmPaystackCheckout"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof confirmPaystackCheckout>>,
    { data: { reference: string } }
  > = ({ data }) => confirmPaystackCheckout(data, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export const useConfirmPaystackCheckoutId = "confirmPaystackCheckout";

export function useConfirmPaystackCheckout<
  TError = ErrorType<unknown>,
  TContext = unknown,
>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof confirmPaystackCheckout>>,
    TError,
    { data: { reference: string } },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationResult<
  Awaited<ReturnType<typeof confirmPaystackCheckout>>,
  TError,
  { data: { reference: string } },
  TContext
> {
  return useMutation(getConfirmPaystackCheckoutMutationOptions(options));
}

export default { useCreatePaystackCheckout, useConfirmPaystackCheckout };
