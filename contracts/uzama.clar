;; Error constants
(define-constant ERR-INVALID-PRICE (err u100))
(define-constant ERR-INVALID-PERIOD (err u101))
(define-constant ERR-EMPTY-RESOURCE (err u102))
(define-constant ERR-PAYMENT-FAILED (err u103))
(define-constant ERR-NOT-AUTHORIZED (err u104))
(define-constant ERR-RESOURCE-NOT-FOUND (err u105))
(define-constant ERR-INSUFFICIENT-PAYMENT (err u106))
(define-constant ERR-NO-EXISTING-ACCESS (err u107))
(define-constant ERR-INVALID-AMOUNT (err u108))
(define-constant ERR-INSUFFICIENT-CONTRACT-BALANCE (err u109))

;; Contract owner
(define-constant CONTRACT-OWNER tx-sender)

;; Resource pricing and availability
(define-map resource-config (string-ascii 64) { 
  price-per-block: uint, 
  min-period: uint, 
  max-period: uint,
  active: bool 
})

;; Access permissions
(define-map access (tuple (resource (string-ascii 64)) (user principal)) { expiry: uint })

;; Track contract-held STX available for withdrawal
(define-data-var contract-balance uint u0)

;; Owner-only function to configure resources
(define-public (set-resource-config (resource (string-ascii 64)) (price-per-block uint) (min-period uint) (max-period uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (> (len resource) u0) ERR-EMPTY-RESOURCE)
    (asserts! (> price-per-block u0) ERR-INVALID-PRICE)
    (asserts! (<= min-period max-period) ERR-INVALID-PERIOD)
    
    (map-set resource-config resource {
      price-per-block: price-per-block,
      min-period: min-period,
      max-period: max-period,
      active: true
    })
    (ok true)))

;; Owner-only function to toggle resource availability without changing pricing
(define-public (set-resource-active (resource (string-ascii 64)) (is-active bool))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (> (len resource) u0) ERR-EMPTY-RESOURCE)
    (let ((config (unwrap! (map-get? resource-config resource) ERR-RESOURCE-NOT-FOUND)))
      (map-set resource-config resource {
        price-per-block: (get price-per-block config),
        min-period: (get min-period config),
        max-period: (get max-period config),
        active: is-active
      })
      (ok true))))

;; Buy access to a resource
(define-public (buy-access (resource (string-ascii 64)) (period uint))
  (let ((config (unwrap! (map-get? resource-config resource) ERR-RESOURCE-NOT-FOUND)))
    (begin
      ;; Input validation
      (asserts! (> (len resource) u0) ERR-EMPTY-RESOURCE)
      (asserts! (get active config) ERR-RESOURCE-NOT-FOUND)
      (asserts! (>= period (get min-period config)) ERR-INVALID-PERIOD)
      (asserts! (<= period (get max-period config)) ERR-INVALID-PERIOD)
      
      ;; Calculate required payment
      (let ((required-price (* (get price-per-block config) period))
            (extension-base (match (map-get? access { resource: resource, user: tx-sender })
                              current-access
                              (let ((current-expiry (get expiry current-access)))
                                (if (> current-expiry stacks-block-height)
                                    current-expiry
                                    stacks-block-height))
                              stacks-block-height)))
        ;; Handle payment with proper error checking
        (unwrap! (stx-transfer? required-price tx-sender (as-contract tx-sender)) ERR-PAYMENT-FAILED)
        (map-set access { resource: resource, user: tx-sender } { expiry: (+ extension-base period) })
        (var-set contract-balance (+ (var-get contract-balance) required-price))
        (ok true)))))

;; NEW: Extend existing access to a resource
(define-public (extend-access (resource (string-ascii 64)) (additional-period uint))
  (let ((config (unwrap! (map-get? resource-config resource) ERR-RESOURCE-NOT-FOUND))
        (current-access (unwrap! (map-get? access { resource: resource, user: tx-sender }) ERR-NO-EXISTING-ACCESS)))
    (begin
      ;; Input validation
      (asserts! (> (len resource) u0) ERR-EMPTY-RESOURCE)
      (asserts! (get active config) ERR-RESOURCE-NOT-FOUND)
      (asserts! (>= additional-period (get min-period config)) ERR-INVALID-PERIOD)
      (asserts! (<= additional-period (get max-period config)) ERR-INVALID-PERIOD)
      
      ;; Calculate required payment for extension
      (let ((required-price (* (get price-per-block config) additional-period))
            (current-expiry (get expiry current-access))
            ;; Extend from current expiry or current block, whichever is later
            (extension-base (if (> current-expiry stacks-block-height) current-expiry stacks-block-height)))
        
        ;; Handle payment
        (unwrap! (stx-transfer? required-price tx-sender (as-contract tx-sender)) ERR-PAYMENT-FAILED)
        ;; Update access with extended expiry
        (map-set access { resource: resource, user: tx-sender } { expiry: (+ extension-base additional-period) })
        (var-set contract-balance (+ (var-get contract-balance) required-price))
        (ok true)))))

;; Owner function to withdraw funds
(define-public (withdraw (amount uint))
  (let ((available (var-get contract-balance)))
    (begin
      (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
      (asserts! (> amount u0) ERR-INVALID-AMOUNT)
      (asserts! (<= amount available) ERR-INSUFFICIENT-CONTRACT-BALANCE)
      (unwrap! (as-contract (stx-transfer? amount tx-sender CONTRACT-OWNER)) ERR-PAYMENT-FAILED)
      (var-set contract-balance (- available amount))
      (ok true))))

;; Check if user has valid access to resource
(define-read-only (has-access (resource (string-ascii 64)) (user principal))
  (match (map-get? access { resource: resource, user: user })
    val (>= (get expiry val) stacks-block-height)
    false))

;; Get resource configuration
(define-read-only (get-resource-config (resource (string-ascii 64)))
  (map-get? resource-config resource))

;; Get user's access expiry for a resource
(define-read-only (get-access-expiry (resource (string-ascii 64)) (user principal))
  (match (map-get? access { resource: resource, user: user })
    val (some (get expiry val))
    none))

;; NEW: Get remaining access time for a resource
(define-read-only (get-remaining-access (resource (string-ascii 64)) (user principal))
  (match (map-get? access { resource: resource, user: user })
    val (if (> (get expiry val) stacks-block-height)
            (some (- (get expiry val) stacks-block-height))
            (some u0))
    none))
