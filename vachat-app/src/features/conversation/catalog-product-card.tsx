import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useCatalogProductImage } from '@/features/conversation/use-catalog-product-image';
import type { CatalogProductCardData } from '@/lib/parse-catalog-product-card';

type CatalogProductCardProps = {
  product: CatalogProductCardData;
  imageUrl?: string;
};

function ProductPrice({ priceLine }: { priceLine?: string }) {
  if (!priceLine) return null;
  const compare = priceLine.match(/^~([^~]+)~\s*(.+)$/);
  if (!compare) {
    return <ThemedText style={styles.price}>{priceLine}</ThemedText>;
  }
  return (
    <View style={styles.priceRow}>
      <ThemedText style={styles.comparePrice}>{compare[1]}</ThemedText>
      <ThemedText style={styles.price}>{compare[2]}</ThemedText>
    </View>
  );
}

export function CatalogProductCard({ product, imageUrl }: CatalogProductCardProps) {
  const [primaryImageFailed, setPrimaryImageFailed] = useState(false);
  const primaryImage = imageUrl && !primaryImageFailed ? imageUrl : undefined;
  const image = useCatalogProductImage(product.handle, product.viewUrl, !primaryImage);
  const resolvedImage = primaryImage || image.data || undefined;

  return (
    <View style={styles.card}>
      {resolvedImage ? (
        <Image
          accessibilityLabel={product.title}
          contentFit="cover"
          onError={() => {
            if (resolvedImage === imageUrl) setPrimaryImageFailed(true);
          }}
          source={{ uri: resolvedImage }}
          style={styles.image}
          transition={150}
        />
      ) : (
        <View style={styles.imagePlaceholder}>
          {image.isLoading ? (
            <ActivityIndicator color="#00A884" />
          ) : (
            <SymbolView
              name={{ android: 'inventory_2', ios: 'shippingbox.fill', web: 'inventory_2' }}
              size={34}
              tintColor="#8696A0"
            />
          )}
        </View>
      )}

      <View style={styles.content}>
        <ThemedText numberOfLines={2} style={styles.title}>
          {product.title}
        </ThemedText>
        <ProductPrice priceLine={product.priceLine} />

        <View style={styles.details}>
          {product.stockLine ? (
            <ThemedText style={styles.stock} type="smallBold">
              {product.stockLine}
            </ThemedText>
          ) : null}
          {product.variantsLine ? (
            <ThemedText style={styles.detail} type="small">
              {product.variantsLine}
            </ThemedText>
          ) : null}
          {product.colorLine ? (
            <ThemedText style={styles.detail} type="small">
              {product.colorLine}
            </ThemedText>
          ) : null}
        </View>
      </View>

      <Pressable
        accessibilityLabel={`View ${product.title}`}
        accessibilityRole="link"
        onPress={() => void Linking.openURL(product.viewUrl)}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
        <ThemedText style={styles.linkText} type="smallBold">
          View product
        </ThemedText>
        <SymbolView
          name={{ android: 'open_in_new', ios: 'arrow.up.right', web: 'open_in_new' }}
          size={16}
          tintColor="#008069"
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(17, 27, 33, 0.10)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
    overflow: 'hidden',
    width: 280,
  },
  image: {
    backgroundColor: '#F0F2F5',
    height: 150,
    width: '100%',
  },
  imagePlaceholder: {
    alignItems: 'center',
    backgroundColor: '#F0F2F5',
    height: 150,
    justifyContent: 'center',
    width: '100%',
  },
  content: {
    gap: 5,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 10,
  },
  title: {
    color: '#111B21',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },
  priceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  comparePrice: {
    color: '#8696A0',
    fontSize: 13,
    textDecorationLine: 'line-through',
  },
  price: {
    color: '#111B21',
    fontSize: 14,
    fontWeight: '700',
  },
  details: {
    gap: 2,
    marginTop: 2,
  },
  stock: {
    color: '#008069',
  },
  detail: {
    color: '#54656F',
  },
  link: {
    alignItems: 'center',
    borderTopColor: '#E9EDEF',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  linkText: {
    color: '#008069',
  },
  pressed: {
    backgroundColor: '#F0F2F5',
  },
});
