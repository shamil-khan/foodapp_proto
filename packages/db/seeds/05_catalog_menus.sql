-- 7. SEED CATEGORIES, MENU ITEMS WITH INGREDIENT HASHTAGS & BRANCH MENU OVERRIDES
INSERT INTO
  "Category" (
    "id",
    "restaurantId",
    "name",
    "sortWeight",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'd0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'Homemade Classics',
    10,
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'd0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000002',
    'Smash Burgers',
    10,
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'd0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000003',
    'Cloud Burgers',
    10,
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'd0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000004',
    'Signature Pizzas',
    10,
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'd0000000-0000-4000-8000-000000000005',
    'a0000000-0000-4000-8000-000000000005',
    'Pan & Stuffed Crust Pizzas',
    10,
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  )
ON CONFLICT ("id") DO NOTHING;

INSERT INTO
  "MenuItem" (
    "id",
    "categoryId",
    "branchId",
    "name",
    "description",
    "basePrice",
    "vatRate",
    "allergenFlags",
    "ingredientTags",
    "kdsTarget",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'e0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    NULL,
    'Special Chicken Biryani (1kg)',
    'Aromatic basmati rice layered with spiced chicken, caramelised onion, and potatoes.',
    9.50,
    0.00,
    ARRAY['Dairy'],
    ARRAY['#chicken', '#onion', '#spicy'],
    'KITCHEN_SCREEN',
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'e0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000002',
    NULL,
    'BiteIn Double Smash',
    'Two aged British beef patties, mature cheddar cheese, crispy onion, house burger sauce.',
    10.99,
    20.00,
    ARRAY['Gluten', 'Dairy', 'Mustard'],
    ARRAY['#beef', '#cheese', '#onion'],
    'KITCHEN_SCREEN',
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'e0000000-0000-4000-8000-000000000003',
    'd0000000-0000-4000-8000-000000000003',
    NULL,
    'Cloud Quadruple Stack',
    'Four smashed beef patties, double mozzarella, smoky jalapeno relish.',
    12.49,
    20.00,
    ARRAY['Gluten', 'Dairy'],
    ARRAY['#beef', '#cheese', '#spicy'],
    'KITCHEN_SCREEN',
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'e0000000-0000-4000-8000-000000000004',
    'd0000000-0000-4000-8000-000000000004',
    NULL,
    'Chicken Tikka Feast Pizza (Large)',
    'Chargrilled chicken tikka, mozzarella cheese, red onion, green peppers.',
    14.99,
    20.00,
    ARRAY['Gluten', 'Dairy'],
    ARRAY['#chicken', '#cheese', '#onion'],
    'KITCHEN_SCREEN',
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'e0000000-0000-4000-8000-000000000005',
    'd0000000-0000-4000-8000-000000000004',
    NULL,
    'Smoky Beef Pepperoni Pan (Large)',
    'Halal beef pepperoni, extra mozzarella cheese, oregano tomato sauce.',
    15.99,
    20.00,
    ARRAY['Gluten', 'Dairy'],
    ARRAY['#beef', '#cheese'],
    'KITCHEN_SCREEN',
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'e0000000-0000-4000-8000-000000000006',
    'd0000000-0000-4000-8000-000000000005',
    NULL,
    'Super Supreme Stuffed Crust',
    'Beef, chicken, mozzarella cheese, onions, mushrooms, and olives.',
    17.49,
    20.00,
    ARRAY['Gluten', 'Dairy'],
    ARRAY[
      '#beef',
      '#chicken',
      '#cheese',
      '#onion'
    ],
    'KITCHEN_SCREEN',
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  )
ON CONFLICT ("id") DO NOTHING;


INSERT INTO
  "BranchMenuOverride" (
    "branchId",
    "menuItemId",
    "isIncluded",
    "isAvailable",
    "priceOverride",
    "approvalStatus",
    "createdBy",
    "updatedBy"
  )
VALUES
  (
    'b0000000-0000-4000-8000-000000000005',
    'e0000000-0000-4000-8000-000000000004',
    TRUE,
    TRUE,
    15.99,
    'APPROVED',
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  ),
  (
    'b0000000-0000-4000-8000-000000000008',
    'e0000000-0000-4000-8000-000000000006',
    TRUE,
    TRUE,
    NULL,
    'NONE',
    pg_temp.seed_actor (),
    pg_temp.seed_actor ()
  )
ON CONFLICT DO NOTHING;
