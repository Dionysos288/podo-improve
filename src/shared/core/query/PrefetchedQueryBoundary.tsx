import {
	QueryClient,
	HydrationBoundary,
	dehydrate,
	type QueryKey,
} from '@tanstack/react-query';

type PrefetchQuery = {
	queryKey: QueryKey;
	queryFn: () => Promise<unknown>;
	staleTime?: number;
	gcTime?: number;
};

type PrefetchedQueryBoundaryProps = {
	queries: PrefetchQuery[];
	children: React.ReactNode;
};

export async function PrefetchedQueryBoundary({
	queries,
	children,
}: PrefetchedQueryBoundaryProps) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 5 * 60 * 1000,
				gcTime: 10 * 60 * 1000,
				refetchOnWindowFocus: false,
				retry: 1,
			},
		},
	});

	await Promise.all(
		queries.map((query) => queryClient.prefetchQuery(query))
	);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			{children}
		</HydrationBoundary>
	);
}
