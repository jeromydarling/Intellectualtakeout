export const SITE = {
  name: 'Intellectual Takeout',
  tagline: 'Feeding Minds, Pursuing Truth',
  taglineHeader: 'Feeding Mind, Pursuing Truth',
  url: 'https://intellectualtakeout.org',
  description:
    'We provide a platform for rational discourse on all aspects of culture, inspiring action that leads to the restoration of a healthy and vibrant America.',
  logo: '/assets/ito-logo.png',
  favicon: '/assets/favicon.png',
  postsPerPage: 12,
  contact: {
    physical: ['8011 34th Ave S Ste C-26', 'Bloomington, MN 55425'],
    mailing: ['PO Box 1244', 'Minnetonka, MN 55345'],
    phone: '(612) 440-0205',
  },
};

export const NAV = [
  {
    label: 'About',
    href: '/about/',
    children: [
      { label: 'Contact Us', href: '/contact/' },
      { label: 'Frequent Contributors', href: '/about/frequent-contributors/' },
      { label: 'Submissions', href: '/submissions/' },
    ],
  },
  { label: 'Donate', href: '/donate/' },
  { label: 'Video', href: '/category/video/' },
  { label: 'Culture', href: '/category/culture/' },
  { label: 'Education', href: '/category/education/' },
  { label: 'Family', href: '/category/family/' },
  { label: 'Health', href: '/category/health/' },
  { label: 'Philosophy', href: '/category/philosophy/' },
  { label: 'Politics', href: '/category/politics/' },
  {
    label: 'More',
    href: '#',
    children: [
      { label: 'Breaking News', href: '/category/breaking-news/' },
      { label: 'Economics', href: '/category/economics/' },
      { label: 'Entertainment', href: '/category/entertainment/' },
      { label: 'History', href: '/category/history/' },
      { label: 'International', href: '/category/international/' },
      { label: 'Literature', href: '/category/literature/' },
      { label: 'Religion', href: '/category/religion/' },
      { label: 'Science', href: '/category/science/' },
    ],
  },
];
