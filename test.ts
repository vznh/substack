import { Newsletter } from './src/index';

const newsletter = new Newsletter('https://billbennett.substack.com');
newsletter.get_posts('new', 1).then(posts => {
  console.log('Post URL:', posts[0].url);
  console.log('Base URL:', posts[0].get_base_url?.() || 'N/A');
}).catch(console.error);