export const SHOP_INFO_QUERY = `
query ShopInfo {
  shop {
    name
    myshopifyDomain
    currencyCode
    primaryDomain { url }
  }
}
`

export const PRODUCTS_SEARCH_QUERY = `
query ProductsSearch($first: Int!, $query: String, $sortKey: ProductSortKeys, $reverse: Boolean) {
  products(first: $first, query: $query, sortKey: $sortKey, reverse: $reverse) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      title
      status
      createdAt
      description
      featuredImage { url }
      variants(first: 20) {
        nodes {
          id
          legacyResourceId
          title
          sku
          availableForSale
          selectedOptions { name value }
          price
          compareAtPrice
          inventoryQuantity
        }
      }
    }
  }
}
`

export const PRODUCT_BY_ID_QUERY = `
query ProductById($id: ID!) {
  product(id: $id) {
    id
    handle
    title
    status
    createdAt
    publishedAt
    description
    featuredImage { url }
    variants(first: 20) {
      nodes {
        id
        legacyResourceId
        title
        sku
        availableForSale
        selectedOptions { name value }
        price
        compareAtPrice
        inventoryQuantity
      }
    }
  }
}
`

export const PRODUCTS_SYNC_QUERY = `
query ProductsSync($first: Int!, $after: String) {
  products(first: $first, after: $after, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      title
      status
      createdAt
      publishedAt
      description
      featuredImage { url }
      variants(first: 20) {
        nodes {
          id
          legacyResourceId
          title
          sku
          availableForSale
          selectedOptions { name value }
          price
          compareAtPrice
        }
      }
    }
  }
}
`

export const CUSTOMERS_BY_QUERY = `
query CustomersByQuery($query: String!) {
  customers(first: 5, query: $query) {
    nodes {
      id
      displayName
      phone
      email
      defaultAddress { phone }
      orders(first: 5, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          id
          name
          displayFinancialStatus
          displayFulfillmentStatus
          createdAt
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 20) {
            nodes { title quantity sku variantTitle }
          }
          fulfillments(first: 5) {
            status
            trackingInfo { number url company }
          }
        }
      }
    }
  }
}
`

export const SHOP_POLICIES_QUERY = `
query ShopPolicies {
  shop {
    shopPolicies {
      type
      title
      body
      url
    }
  }
}
`

export const PAGES_SYNC_QUERY = `
query PagesSync($first: Int!, $after: String) {
  pages(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      title
      body
      isPublished
    }
  }
}
`

export const PAGE_BY_ID_QUERY = `
query PageById($id: ID!) {
  page(id: $id) {
    id
    handle
    title
    body
    isPublished
  }
}
`

export const ORDERS_BY_QUERY = `
query OrdersByQuery($query: String!) {
  orders(first: 5, query: $query) {
    nodes {
      id
      name
      displayFinancialStatus
      displayFulfillmentStatus
      createdAt
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { phone email displayName }
      shippingAddress { phone }
      billingAddress { phone }
      lineItems(first: 20) {
        nodes { title quantity sku variantTitle }
      }
      fulfillments(first: 5) {
        status
        trackingInfo { number url company }
      }
    }
  }
}
`
