import { HeroSection } from '../components/landing/HeroSection'
import { DualColumnSection } from '../components/landing/DualColumnSection'
import { CommonContentRow } from '../components/landing/CommonContentRow'

const Home = () => {
  return (
    <div>
        <HeroSection />
        <DualColumnSection />
        <CommonContentRow />
    </div>
  )
}

export default Home