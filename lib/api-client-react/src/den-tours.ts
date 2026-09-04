// ---------------------------------------------------------------------------
// Den tours — hand-written react-query hooks for the category ACCESS / TOUR
// endpoints on the tickets router (tickets.ts). The den apps consult these on
// every load so the one-time 10-minute preview tour is enforced server-side:
//
//   GET  /tickets/access/:category  — pass/tour entry state for one den
//   POST /tickets/tour/start        — grant the viewer's one-time tour
//
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

export type TicketCategory = "authors" | "content-creators";

export type TicketCategoryAccess = {
  category: TicketCategory;
  tourMinutes: number;
  passActive: boolean;
  tourActive: boolean;
  tourEndsAt: string | null;
  tourUsed: boolean;
  canStartTour: boolean;
};

export type TicketTourStarted = {
  tour: {
    category: TicketCategory;
    tourMinutes: number;
    startedAt: string;
    endsAt: string;
  };
};

// ---- category access status ----

export const getTicketCategoryAccessUrl = (category: TicketCategory) => `/api/tickets/access/${category}`;

export const getTicketCategoryAccess = (
  category: TicketCategory,
  options?: Parameters<typeof customFetch>[1],
): Promise<TicketCategoryAccess> =>
  customFetch<TicketCategoryAccess>(getTicketCategoryAccessUrl(category), { ...options, method: "GET" });

export const getTicketCategoryAccessQueryKey = (category: TicketCategory) =>
  ["ticket-access", category] as const;

export const getTicketCategoryAccessQueryOptions = <
  TData = Awaited<ReturnType<typeof getTicketCategoryAccess>>,
  TError = ErrorType<unknown>,
>(
  category: TicketCategory,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTicketCategoryAccess>>, TError, TData> & {
      queryKey?: QueryKey;
    };
    request?: Parameters<typeof customFetch>[1];
  },
) => {
  const { query: queryOptions, request: requestOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getTicketCategoryAccessQueryKey(category);
  const queryFn: QueryFunction<Awaited<ReturnType<typeof getTicketCategoryAccess>>> = ({ signal }) =>
    getTicketCategoryAccess(category, { signal, ...requestOptions });
  return { queryKey, queryFn, ...queryOptions } as UseQueryOptions<
    Awaited<ReturnType<typeof getTicketCategoryAccess>>,
    TError,
    TData
  > & { queryKey: QueryKey };
};

export function useTicketCategoryAccess<
  TData = Awaited<ReturnType<typeof getTicketCategoryAccess>>,
  TError = ErrorType<unknown>,
>(
  category: TicketCategory,
  options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTicketCategoryAccess>>, TError, TData> & {
      queryKey?: QueryKey;
    };
    request?: Parameters<typeof customFetch>[1];
  },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const queryOptions = getTicketCategoryAccessQueryOptions(category, options);
  const query = useQuery(queryOptions) as UseQueryResult<TData, TError> & { queryKey: QueryKey };
  return withQueryKey(query, queryOptions.queryKey);
}

// ---- start the one-time tour ----

export const startTicketTour = async (
  category: TicketCategory,
  options?: Parameters<typeof customFetch>[1],
): Promise<TicketTourStarted> =>
  customFetch<TicketTourStarted>("/api/tickets/tour/start", {
    ...options,
    method: "POST",
    headers: { "Content-Type": "application/json", ...options?.headers },
    body: JSON.stringify({ category }),
  });

export const getStartTicketTourMutationOptions = <TError = ErrorType<unknown>, TContext = unknown>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof startTicketTour>>,
      TError,
      { category: TicketCategory },
      TContext
    >;
    request?: Parameters<typeof customFetch>[1];
  },
): UseMutationOptions<
  Awaited<ReturnType<typeof startTicketTour>>,
  TError,
  { category: TicketCategory },
  TContext
> => {
  const mutationKey = ["startTicketTour"];
  const { mutation: mutationOptions, request: requestOptions } = options
    ? options.mutation && "mutationKey" in options.mutation && options.mutation.mutationKey
      ? options
      : { ...options, mutation: { ...options.mutation, mutationKey } }
    : { mutation: { mutationKey }, request: undefined };
  const mutationFn: MutationFunction<
    Awaited<ReturnType<typeof startTicketTour>>,
    { category: TicketCategory }
  > = ({ category }) => startTicketTour(category, requestOptions);
  return { mutationFn, ...mutationOptions };
};

export const useStartTicketTourMutationId = "startTicketTour";

export function useStartTicketTour<TError = ErrorType<unknown>, TContext = unknown>(options?: {
  mutation?: UseMutationOptions<
    Awaited<ReturnType<typeof startTicketTour>>,
    TError,
    { category: TicketCategory },
    TContext
  >;
  request?: Parameters<typeof customFetch>[1];
}): UseMutationResult<
  Awaited<ReturnType<typeof startTicketTour>>,
  TError,
  { category: TicketCategory },
  TContext
> {
  return useMutation(getStartTicketTourMutationOptions(options));
}

function withQueryKey<T extends object, K>(query: T, queryKey: K): T & { queryKey: K } {
  const result = { queryKey } as T & { queryKey: K };
  for (const key of Object.keys(query)) {
    if (key === "queryKey") continue;
    Object.defineProperty(result, key, { enumerable: true, configurable: true, get: () => (query as Record<string, unknown>)[key] });
  }
  return result;
}

export default { useTicketCategoryAccess, useStartTicketTour };
