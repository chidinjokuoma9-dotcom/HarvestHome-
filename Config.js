window.HARVESTHOME_CONFIG = {
  APP_NAME: "HarvestHome",
  VERSION: "V7",
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",
  PAYSTACK_PUBLIC_KEY: "YOUR_PAYSTACK_PUBLIC_KEY",
  MAP_PROVIDER: "OpenStreetMap",
  MAX_IMAGE_FILES: 6,
  MAX_VIDEO_FILES: 1,
  MAX_VIDEO_MB: 25,
  DEFAULT_COUNTRY: "Nigeria",
  DEFAULT_CURRENCY: "NGN",
  SUPPORTED_COUNTRIES: [
    { name:"Nigeria", code:"NG", currency:"NGN", symbol:"₦" }, { name:"Ghana", code:"GH", currency:"GHS", symbol:"GH₵" },
    { name:"Kenya", code:"KE", currency:"KES", symbol:"KSh" }, { name:"South Africa", code:"ZA", currency:"ZAR", symbol:"R" },
    { name:"United Kingdom", code:"GB", currency:"GBP", symbol:"£" }, { name:"United States", code:"US", currency:"USD", symbol:"$" },
    { name:"Canada", code:"CA", currency:"CAD", symbol:"C$" }, { name:"United Arab Emirates", code:"AE", currency:"AED", symbol:"AED " }
  ],
  CATEGORIES: ["All categories", "Houses", "Land", "Equipment", "Farm Produce", "Commercial Property", "Vehicles & Machinery", "Agricultural Services"],
  MODES: ["All", "Sale", "Lease"],
  LOCATIONS: { Nigeria:["All locations","Abuja","Lagos","Rivers","Kaduna","Nasarawa","Niger"], Ghana:["All locations","Accra","Kumasi","Takoradi"], Kenya:["All locations","Nairobi","Mombasa","Nakuru"], "South Africa":["All locations","Johannesburg","Cape Town","Durban"], "United Kingdom":["All locations","London","Birmingham","Manchester"], "United States":["All locations","Texas","California","Florida"], Canada:["All locations","Ontario","Alberta","British Columbia"], "United Arab Emirates":["All locations","Dubai","Abu Dhabi","Sharjah"] }
};
