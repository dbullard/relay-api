create unique index if not exists subscriptions_provider_subscription_id_key
on public.subscriptions (provider, provider_subscription_id)
where provider_subscription_id is not null;

create unique index if not exists subscriptions_provider_original_transaction_id_key
on public.subscriptions (provider, original_transaction_id)
where original_transaction_id is not null;
