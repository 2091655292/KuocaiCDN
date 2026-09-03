package com.kuocai.cdn.service;

import com.kuocai.cdn.entity.SelfHostedNode;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.Predicate;

/** Selects one stable writer for nodes backed by the same storage. */
public final class SelfHostedCacheWriterSelector {
    private SelfHostedCacheWriterSelector() {
    }

    public static SelfHostedNode select(List<SelfHostedNode> candidates) {
        List<SelfHostedNode> enabled = new ArrayList<>();
        if (candidates != null) {
            for (SelfHostedNode candidate : candidates) {
                if (candidate != null && Integer.valueOf(1).equals(candidate.getEnabled())) {
                    enabled.add(candidate);
                }
            }
        }
        enabled.sort(Comparator.comparing(SelfHostedNode::getId,
                Comparator.nullsLast(Comparator.naturalOrder())));
        if (enabled.isEmpty()) {
            return null;
        }

        // desiredConfig is fetched independently by every agent. Selecting from a short
        // heartbeat window can therefore make two agents choose each other during a status
        // transition, creating a relay loop. Keep the writer deterministic until an
        // administrator changes the preferred writer or disables/removes that node.
        SelfHostedNode selected = first(enabled, SelfHostedCacheWriterSelector::preferred);
        return selected == null ? enabled.get(0) : selected;
    }

    private static SelfHostedNode first(List<SelfHostedNode> nodes, Predicate<SelfHostedNode> predicate) {
        for (SelfHostedNode node : nodes) {
            if (predicate.test(node)) {
                return node;
            }
        }
        return null;
    }

    private static boolean preferred(SelfHostedNode node) {
        return Integer.valueOf(1).equals(node.getCacheStorageWriter());
    }
}
