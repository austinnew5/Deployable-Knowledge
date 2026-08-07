<script lang="ts">
	import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
	import { mergeProps } from 'bits-ui';
	import { buttonVariants } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { cn } from '$lib/components/ui/utils';
	import type { DocumentSortMode } from '$lib/types';

	const SORT_OPTIONS: readonly { value: DocumentSortMode; label: string }[] = [
		{ value: 'title-asc', label: 'A → Z' },
		{ value: 'title-desc', label: 'Z → A' },
		{ value: 'newest', label: 'Newest' },
		{ value: 'oldest', label: 'Oldest' },
		{ value: 'most-chunks', label: 'Most chunks' },
		{ value: 'least-chunks', label: 'Least chunks' }
	];

	interface Props {
		onChange: (value: DocumentSortMode) => void;
		value: DocumentSortMode;
	}

	let { onChange, value }: Props = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Tooltip.Root>
				<Tooltip.Trigger
					{...mergeProps(props, {
						class: cn(buttonVariants({ variant: 'outline', size: 'icon' }), 'cursor-pointer')
					})}
				>
					<ArrowUpDown />
				</Tooltip.Trigger>
				<Tooltip.Content>Sort documents</Tooltip.Content>
			</Tooltip.Root>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-44">
		<DropdownMenu.RadioGroup {value} onValueChange={(next) => onChange(next as DocumentSortMode)}>
			{#each SORT_OPTIONS as option (option.value)}
				<DropdownMenu.RadioItem value={option.value}>{option.label}</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
