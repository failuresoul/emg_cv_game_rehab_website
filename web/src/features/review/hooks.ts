import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { SILENT } from "@/lib/apiErrors";
import type {
  BlindItem,
  BlindItemSummary,
  RatingRead,
  ReviewRatingCreate,
  ReviewResults,
  ReviewSetCreate,
  ReviewSetRead,
} from "@/types/api";

const REVIEW_KEY = "review";

export function useReviewSets() {
  return useQuery({
    queryKey: [REVIEW_KEY, "sets"],
    queryFn: async () => (await api.get<ReviewSetRead[]>("/admin/review-sets")).data,
    // While a set's LLM reports are being written.
    refetchInterval: (query) =>
      query.state.data?.some((set) => set.status === "building") ? 5000 : false,
  });
}

export function useCreateReviewSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: ReviewSetCreate) =>
      (await api.post<ReviewSetRead>("/admin/review-sets", body)).data,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [REVIEW_KEY] }),
  });
}

export function useReviewItems(setId: number, enabled: boolean) {
  return useQuery({
    queryKey: [REVIEW_KEY, "items", setId],
    queryFn: async () =>
      (await api.get<BlindItemSummary[]>(`/admin/review-sets/${setId}/items`)).data,
    enabled,
  });
}

export function useReviewItem(setId: number, code: string | null) {
  return useQuery({
    queryKey: [REVIEW_KEY, "item", setId, code],
    queryFn: async () =>
      (await api.get<BlindItem>(`/admin/review-sets/${setId}/items/${code}`)).data,
    enabled: code !== null,
  });
}

export function useRateItem(setId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, rating }: { code: string; rating: ReviewRatingCreate }) =>
      (await api.post<RatingRead>(`/admin/review-sets/${setId}/items/${code}/rating`, rating)).data,
    // The form shows its own errors.
    meta: SILENT,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [REVIEW_KEY] }),
  });
}

export function useReviewResults(setId: number) {
  return useQuery({
    queryKey: [REVIEW_KEY, "results", setId],
    queryFn: async () => (await api.get<ReviewResults>(`/admin/review-sets/${setId}/results`)).data,
  });
}

/** The next item to rate: the first unrated one after `current` in the shuffled order, else
 * the first unrated one; null when every item is rated. */
export function nextUnrated(
  items: readonly BlindItemSummary[],
  current: string | null,
): string | null {
  const unrated = items.filter((item) => !item.rated_by_me);
  if (unrated.length === 0) return null;
  const position = items.find((item) => item.code === current)?.position ?? 0;
  return (unrated.find((item) => item.position > position) ?? unrated[0])!.code;
}
