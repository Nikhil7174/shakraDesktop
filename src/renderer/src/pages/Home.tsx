import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeroSection } from '../components/landing/HeroSection'
import { DualColumnSection } from '../components/landing/DualColumnSection'
import { CommonContentRow } from '../components/landing/CommonContentRow'

const Home = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is logged in and redirect to candidate dashboard
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    
    if (token && user) {
      try {
        const userData = JSON.parse(user);
        // Redirect to candidate dashboard
        if (userData.userType === 'candidate') {
          navigate('/candidate/dashboard', { replace: true });
        }
      } catch (error) {
        console.error('Error parsing user data:', error);
      }
    }
  }, [navigate]);

  return (
    <div>
        <HeroSection />
        <DualColumnSection />
        <CommonContentRow />
    </div>
  )
}

export default Home