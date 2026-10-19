import { useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import MenuIcon from '@mui/icons-material/Menu';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import SearchIcon from '@mui/icons-material/Search';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import TuneIcon from '@mui/icons-material/Tune';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import DynamicFeedOutlinedIcon from '@mui/icons-material/DynamicFeedOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import CableIcon from '@mui/icons-material/Cable';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { DemoBanner } from '../components/DemoBanner';
import { NAV_ITEMS, PLACEHOLDERS } from '../content/pages';
import { BrokerPage } from '../pages/BrokerPage';
import { PositionDetailPage, PositionsPage } from '../pages/BrokeragePages';
import { DiscoverOpportunitiesPage } from '../pages/DiscoverOpportunitiesPage';
import { LeapsFinderPage } from '../pages/LeapsFinderPage';
import { OverviewPage } from '../pages/OverviewPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { SettingsPage } from '../pages/SettingsPage';
import { StrategyBuilderPage } from '../pages/StrategyBuilderPage';
import { Wordmark } from '../brand/Wordmark';
import { brand } from '../brand/tokens';

const DRAWER_WIDTH = 268;

const NAV_ICONS: Record<string, typeof HomeOutlinedIcon> = {
  '/': HomeOutlinedIcon,
  '/leaps': SearchIcon,
  '/discover': TravelExploreIcon,
  '/strategies': TuneIcon,
  '/pmcc': AccountTreeOutlinedIcon,
  '/positions': LayersOutlinedIcon,
  '/risk': ScienceOutlinedIcon,
  '/research': DynamicFeedOutlinedIcon,
  '/journal': MenuBookOutlinedIcon,
  '/broker': CableIcon,
  '/settings': SettingsOutlinedIcon,
};

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: brand.color.background }}>
      <Box sx={{ px: 2.25, pt: 2.25, pb: 1.5 }}>
        <Wordmark />
      </Box>
      <List sx={{ px: 1.25, flex: 1 }}>
        {NAV_ITEMS.map((item) => (
          <ListItemButton
            key={item.to}
            component={NavLink}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            sx={{
              mb: 0.5,
              borderRadius: `${brand.radius.nav}px`,
              borderLeft: '3px solid transparent',
              transition: `background-color ${brand.motion.fast} ${brand.motion.ease}, border-color ${brand.motion.fast} ${brand.motion.ease}, color ${brand.motion.fast} ${brand.motion.ease}`,
              '&:hover': { backgroundColor: 'rgba(18, 217, 175, 0.06)' },
              '&.active': {
                backgroundColor: 'rgba(18, 217, 175, 0.14)',
                borderLeftColor: brand.color.emerald,
                color: brand.color.text,
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>
              {(() => {
                const Icon = NAV_ICONS[item.to] ?? HomeOutlinedIcon;
                return <Icon fontSize="small" />;
              })()}
            </ListItemIcon>
            <ListItemText primary={item.label} sx={{ '& .MuiListItemText-primary': { fontSize: 14, fontWeight: 600 } }} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ px: 2.5, py: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Phase 1C · No order routing
        </Typography>
      </Box>
    </Box>
  );
}

export function AppShell() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const drawer = (
    <Drawer
      variant={desktop ? 'permanent' : 'temporary'}
      open={desktop || open}
      onClose={() => setOpen(false)}
      ModalProps={{ keepMounted: true }}
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          boxSizing: 'border-box',
          borderRight: `1px solid ${brand.color.border}`,
          backgroundColor: brand.color.background,
        },
      }}
    >
      <Sidebar onNavigate={() => setOpen(false)} />
    </Drawer>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {drawer}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {desktop ? null : (
          <Toolbar sx={{ borderBottom: '1px solid rgba(146, 176, 210, 0.14)' }}>
            <IconButton edge="start" aria-label="Open navigation" onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>
            <Box sx={{ ml: 1 }}>
              <Wordmark compact />
            </Box>
          </Toolbar>
        )}
        <DemoBanner />
        <Box key={pathname} className="os-page" component="main" sx={{ p: { xs: 2, md: 3 }, flex: 1 }}>
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/leaps" element={<LeapsFinderPage />} />
            <Route path="/discover" element={<DiscoverOpportunitiesPage />} />
            <Route path="/strategies" element={<StrategyBuilderPage />} />
            <Route path="/positions/:positionId" element={<PositionDetailPage />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/broker" element={<BrokerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {Object.entries(PLACEHOLDERS).map(([path, copy]) => (
              <Route key={path} path={path} element={<PlaceholderPage {...copy} />} />
            ))}
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}
