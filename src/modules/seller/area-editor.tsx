import * as React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import type { ServiceArea } from '@/api/vanta-api';
import { Button, Field } from '@/components/ui';
import { colors, radius, spacing, type } from '@/theme/tokens';

export function AreaEditor({
  primaryArea,
  serviceAreas,
  suggestions,
  onPrimaryChange,
  onServiceAreasChange,
}: {
  primaryArea: string;
  serviceAreas: string[];
  suggestions: ServiceArea[];
  onPrimaryChange: (value: string) => void;
  onServiceAreasChange: (value: string[]) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState('');
  const add = (value: string): void => {
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name || serviceAreas.some((item) => item.toLowerCase() === name.toLowerCase())) return;
    onServiceAreasChange([...serviceAreas, name]);
    setDraft('');
  };
  const toggleSuggestion = (area: ServiceArea): void => {
    const selected = serviceAreas.some((item) => item.toLowerCase() === area.name.toLowerCase());
    onServiceAreasChange(selected ? serviceAreas.filter((item) => item.toLowerCase() !== area.name.toLowerCase()) : [...serviceAreas, area.name]);
  };

  return (
    <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
      <Field label="Shop Area (Primary Village/Area)" value={primaryArea} onChangeText={onPrimaryChange} placeholder="e.g. Najarpur" />
      <Text style={[type.caption, { color: colors.textMuted }]}>Delivery Areas (Neighboring Villages/Areas)</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => add(draft)}
          placeholder="Type an area and add it"
          returnKeyType="done"
          accessibilityLabel="New delivery area"
          style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surface }}
        />
        <Button title="Add" variant="secondary" onPress={() => add(draft)} disabled={!draft.trim()} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {serviceAreas.map((area) => (
          <Pressable key={area.toLowerCase()} onPress={() => onServiceAreasChange(serviceAreas.filter((item) => item !== area))} accessibilityRole="button" accessibilityLabel={`Remove ${area}`} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft }}>
            <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>{area} ×</Text>
          </Pressable>
        ))}
      </View>
      {suggestions.length ? <Text style={[type.caption, { color: colors.textMuted }]}>Known areas — tap to add or remove</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {suggestions.map((area) => {
          const selected = serviceAreas.some((item) => item.toLowerCase() === area.name.toLowerCase());
          return <Pressable key={area.slug} onPress={() => toggleSuggestion(area)} accessibilityRole="button" accessibilityState={{ selected }} style={{ paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.surface }}><Text style={{ fontSize: 12, color: selected ? colors.primary : colors.text }}>{area.name}</Text></Pressable>;
        })}
      </View>
    </View>
  );
}
